import { test } from 'vitest';
import http from 'node:http';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fixture, KEY_A, KEY_B } from './helpers.mjs';
import { EvidenceStore, recordDigest } from '../src/store.mjs';
import { publicPaths } from '../src/site.mjs';
import { loadConfig, authenticate } from '../src/config.mjs';
const request = { url: 'https://example.com', assert: { text_contains: 'release:v1' } };
const mcpHeaders = { accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' };
const rpc = (method, params = {}, id = 1) => ({ jsonrpc: '2.0', id, method, params });
test('REST verification persists full evidence, enforces ownership and survives store restart', async t => {
  const f = await fixture(t);
  const result = await f.call('/v1/verify/website', { body: request });
  assert.equal(result.status, 200); assert.equal(result.json.verdict, 'pass'); assert.equal(result.json.record, undefined);
  const id = result.json.evidence_id;
  const full = await f.call(`/v1/evidence/${id}`);
  assert.equal(full.json.record.evidence_id, id); assert.equal(recordDigest(full.json.record), full.json.integrity.digest);
  assert.equal((await f.call(`/v1/evidence/${id}`, { key: KEY_B })).status, 404);
  const disk = await readFile(f.store.path(id), 'utf8'); assert.ok(!disk.includes(KEY_A)); assert.ok(!disk.includes('hello release:v1'));
  await f.store.close();
  const reopened = await new EvidenceStore(f.cfg).init();
  assert.equal((await reopened.get('alice', id)).record.verdict, 'pass'); await reopened.close();
});
test('missing/invalid authorization fails closed', async t => { const f = await fixture(t); assert.equal((await f.call('/v1/verify/website', { key: null, body: request })).status, 401); assert.equal((await f.call('/mcp', { key: 'invalid', body: rpc('ping'), headers: mcpHeaders })).status, 401); });
test('Origin and Host are checked; forwarded headers do not alter rate identity', async t => { const f = await fixture(t); assert.equal((await f.call('/mcp', { body: rpc('ping'), headers: { ...mcpHeaders, origin: 'https://evil.example' } })).status, 403); const hostStatus = await new Promise((resolve, reject) => { const r = http.get(f.base + '/healthz', { headers: { host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); r.on('error', reject); }); assert.equal(hostStatus, 403); assert.equal((await f.call('/v1/verify/website', { body: request, headers: { 'x-forwarded-for': '127.0.0.1' } })).status, 200); });
test('SSRF policy applies to REST', async t => { const f = await fixture(t); const result = await f.call('/v1/verify/website', { body: { url: 'https://169.254.169.254/' } }); assert.equal(result.status, 400); assert.equal(result.json.error.code, 'ADDRESS_BLOCKED'); });
test('bad JSON, wrong media type, unknown fields and large bodies are rejected', async t => { const f = await fixture(t); assert.equal((await f.call('/v1/verify/website', { body: '{' })).status, 400); assert.equal((await f.call('/v1/verify/website', { body: request, headers: { 'content-type': 'text/plain' } })).status, 415); assert.equal((await f.call('/v1/verify/website', { body: { ...request, arbitrary: true } })).status, 400); assert.equal((await f.call('/v1/verify/website', { body: JSON.stringify({ url: 'x'.repeat(20000) }) })).status, 413); });
test('wrong methods, invalid evidence detail and missing endpoints return honest errors', async t => { const f = await fixture(t); assert.equal((await f.call('/v1/verify/website')).status, 405); assert.equal((await f.call('/v1/evidence/x?detail=wrong')).status, 400); assert.equal((await f.call('/not-here')).status, 404); });
test('MCP initialize, list, call and evidence read complete a real HTTP round trip', async t => {
  const f = await fixture(t);
  const invoke = async (method, params) => f.call('/mcp', { body: rpc(method, params), headers: mcpHeaders });
  const init = await invoke('initialize', { protocolVersion: '2025-11-25', clientInfo: { name: 'wire-test', version: '1.0' }, capabilities: {} });
  assert.equal(init.json.result.protocolVersion, '2025-11-25');
  const notification = await f.call('/mcp', { body: { jsonrpc: '2.0', method: 'notifications/initialized' }, headers: mcpHeaders }); assert.equal(notification.status, 202); assert.equal(notification.text, '');
  assert.equal((await invoke('tools/list')).json.result.tools.length, 2);
  const call = await invoke('tools/call', { name: 'verify_website', arguments: request });
  assert.equal(call.json.result.isError, false); assert.equal(call.json.result.structuredContent.verdict, 'pass');
  const saved = await invoke('tools/call', { name: 'get_evidence', arguments: { evidence_id: call.json.result.structuredContent.evidence_id } });
  assert.equal(saved.json.result.structuredContent.record.verdict, 'pass');
});
test('MCP tool policy errors are structured errors, assertion failures are normal results', async t => {
  const f = await fixture(t);
  const invoke = args => f.call('/mcp', { body: rpc('tools/call', { name: 'verify_website', arguments: args }), headers: mcpHeaders });
  assert.equal((await invoke({ url: 'https://127.0.0.1' })).json.result.isError, true);
  const failure = await invoke({ ...request, assert: { text_contains: 'missing' } });
  assert.equal(failure.json.result.isError, false); assert.equal(failure.json.result.structuredContent.verdict, 'fail');
});
test('MCP transport rejects invalid accept, protocol, batch and unsupported methods', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/mcp', { body: rpc('ping') })).status, 406);
  assert.equal((await f.call('/mcp', { body: rpc('ping'), headers: { ...mcpHeaders, 'mcp-protocol-version': 'future' } })).status, 400);
  assert.equal((await f.call('/mcp', { body: [rpc('ping')], headers: mcpHeaders })).json.error.code, -32600);
  assert.equal((await f.call('/mcp', { body: rpc('unknown'), headers: mcpHeaders })).json.error.code, -32601);
  assert.equal((await f.call('/mcp', { body: '{', headers: mcpHeaders })).json.error.code, -32700);
  assert.equal((await f.call('/mcp')).status, 405);
});
test('request rate limit is per authenticated client and returns retry-after', async t => { const f = await fixture(t, { config: { requestsPerMinute: 1 } }); assert.equal((await f.call('/mcp', { body: rpc('ping'), headers: mcpHeaders })).status, 200); const blocked = await f.call('/mcp', { body: rpc('ping'), headers: mcpHeaders }); assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '60'); assert.equal((await f.call('/mcp', { key: KEY_B, body: rpc('ping'), headers: mcpHeaders })).status, 200); });
test('concurrency saturation rejects rather than queueing unbounded work', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { config: { concurrency: 1 }, dependencies: { fetchOne: async () => { await gate; throw new Error('simulated'); } } });
  const first = f.service.verify('alice', request);
  await assert.rejects(f.service.verify('bob', request), { code: 'SERVICE_BUSY' });
  release(); await first; assert.equal(f.service.active, 0);
});
test('evidence quota is enforced without deleting unexpired records', async t => { const f = await fixture(t, { config: { maxClientEvidence: 1 } }); const first = await f.service.verify('alice', request); await assert.rejects(f.service.verify('alice', request), { code: 'EVIDENCE_CAPACITY' }); assert.equal((await f.store.get('alice', first.evidence_id)).record.verdict, 'pass'); });
test('expired records are inaccessible and removed by cleanup', async t => { const f = await fixture(t, { config: { evidenceTtlMs: 5 } }); const r = await f.service.verify('alice', request); await new Promise(resolve => setTimeout(resolve, 15)); await assert.rejects(f.store.get('alice', r.evidence_id), { code: 'EVIDENCE_NOT_FOUND' }); await f.store.cleanup(); assert.equal(f.store.index.size, 0); });
test('stored evidence corruption is detected', async t => { const f = await fixture(t); const r = await f.service.verify('alice', request); const path = f.store.path(r.evidence_id); const data = JSON.parse(await readFile(path, 'utf8')); data.record.verdict = 'fail'; await writeFile(path, JSON.stringify(data)); await assert.rejects(f.store.get('alice', r.evidence_id), { code: 'EVIDENCE_CORRUPT' }); });
test('all crawlable pages have title, canonical, description, semantic h1 and valid JSON-LD', async t => { const f = await fixture(t); for (const path of publicPaths) { const r = await f.call(path, { key: null }); assert.equal(r.status, 200); assert.match(r.text, /<h1>/); assert.match(r.text, /name="description"/); assert.match(r.text, /rel="canonical"/); const jsonld = r.text.match(/type="application\/ld\+json">(.*?)<\/script>/s); assert.ok(JSON.parse(jsonld[1])['@type']); assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/); } });
test('SEO and agent-discovery resources match canonical routes', async t => { const f = await fixture(t); const map = await f.call('/sitemap.xml'); for (const path of publicPaths) assert.ok(map.text.includes(f.cfg.baseUrl + path)); assert.match((await f.call('/robots.txt')).text, /Disallow: \//); assert.match((await f.call('/llms-full.txt')).text, /inconclusive/); const spec = (await f.call('/openapi.json')).json; assert.equal(spec.openapi, '3.1.0'); assert.ok(spec.paths['/v1/verify/website'].post.requestBody); assert.equal((await f.call('/agent.json')).json.manifest_status, 'project_specific_not_a_universal_standard'); });
test('logs exclude keys, target URLs and assertion values', async t => { const f = await fixture(t); await f.call('/v1/verify/website', { body: request }); const logs = JSON.stringify(f.logs); assert.ok(!logs.includes(KEY_A)); assert.ok(!logs.includes('example.com')); assert.ok(!logs.includes('release:v1')); });
test('key configuration fails closed, can rotate secret while retaining client ID', () => { assert.throws(() => loadConfig({})); assert.throws(() => loadConfig({ API_KEYS: 'alice:short' })); assert.throws(() => loadConfig({ API_KEYS: `alice:${KEY_A},alice:${KEY_B}` })); assert.throws(() => loadConfig({ API_KEYS: `alice:${KEY_A}`, NODE_ENV: 'production', PUBLIC_BASE_URL: 'http://example.com' })); const cfg = loadConfig({ API_KEYS: `alice:${KEY_B}` }); assert.equal(authenticate(`Bearer ${KEY_A}`, cfg.keys), null); assert.equal(authenticate(`Bearer ${KEY_B}`, cfg.keys), 'alice'); });

test('chunked oversized bodies receive 413 without buffering the remainder', async t => {
  const f = await fixture(t);
  const status = await new Promise((resolve, reject) => {
    const req = http.request(f.base + '/v1/verify/website', { method: 'POST', headers: { authorization: `Bearer ${KEY_A}`, 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.write('x'.repeat(17000)); req.end();
  });
  assert.equal(status, 413);
});
test('MCP accepts response messages and rejects scalar params', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/mcp', { body: { jsonrpc: '2.0', id: 3, result: {} }, headers: mcpHeaders })).status, 202);
  assert.equal((await f.call('/mcp', { body: rpc('ping', 42), headers: mcpHeaders })).json.error.code, -32602);
});
