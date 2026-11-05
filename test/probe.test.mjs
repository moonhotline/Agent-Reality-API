import { test } from 'vitest';
import assert from 'node:assert/strict';
import http from 'node:http';
import { probeWebsite, fetchPinned, pinnedLookup } from '../src/probe.mjs';
import { validateInput, jsonPointer } from '../src/schema.mjs';
import { config, response, publicResolver } from './helpers.mjs';
const cfg = config();
const run = (raw, reply, options = {}) => probeWebsite(validateInput(raw), { ...cfg, ...options.config }, { resolveHost: publicResolver, fetchOne: async () => reply, ...options.dependencies });
test('passes explicit source and status assertions', async () => { const result = await run({ url: 'https://example.com', assert: { status: 200, text_contains: 'release:v1' } }, response()); assert.equal(result.verdict, 'pass'); assert.equal(result.response.digest_scope, 'complete_response_body'); });
test('200 with missing release marker fails', async () => { const result = await run({ url: 'https://example.com', assert: { text_contains: 'release:v2' } }, response()); assert.equal(result.verdict, 'fail'); assert.equal(result.ok, false); });
test('truncated missing match is inconclusive, never false pass/fail', async () => { const r = await run({ url: 'https://example.com', assert: { text_contains: 'missing' } }, response('partial', { complete: false })); assert.equal(r.verdict, 'inconclusive'); assert.equal(r.ok, null); assert.equal(r.response.digest_scope, 'captured_prefix'); });
test('positive prefix match can pass and retains truncation limitation', async () => { const r = await run({ url: 'https://example.com', assert: { text_contains: 'part' } }, response('partial', { complete: false })); assert.equal(r.verdict, 'pass'); assert.ok(r.limitations.includes('body_truncated')); });
test('compressed source cannot produce a content success', async () => { const r = await run({ url: 'https://example.com', assert: { text_contains: 'hello' } }, response('hello', { content_encoding: 'gzip' })); assert.equal(r.verdict, 'inconclusive'); });
test('unsupported charset is inconclusive', async () => { const r = await run({ url: 'https://example.com', assert: { text_contains: 'hello' } }, response('hello', { content_type: 'text/html; charset=iso-8859-1' })); assert.equal(r.verdict, 'inconclusive'); });
test('complete JSON scalar and escaped pointers compare correctly', async () => { const r = await run({ url: 'https://example.com', assert: { json: { pointer: '/a~1b/~0key/0', equals: 'v1' } } }, response('{"a/b":{"~key":["v1"]}}')); assert.equal(r.verdict, 'pass'); });
test('JSON invalid syntax fails only on a complete body', async () => { const request = { url: 'https://example.com', assert: { json: { pointer: '/ok', equals: true } } }; assert.equal((await run(request, response('{'))).verdict, 'fail'); assert.equal((await run(request, response('{', { complete: false }))).verdict, 'inconclusive'); });
test('missing pointer and wrong value fail', async () => { const request = { url: 'https://example.com', assert: { json: { pointer: '/ok', equals: true } } }; assert.equal((await run(request, response('{"ok":false}'))).verdict, 'fail'); assert.equal((await run(request, response('{}'))).verdict, 'fail'); });
test('HTTP status mismatch fails', async () => assert.equal((await run({ url: 'https://example.com' }, response('', { status: 503 }))).verdict, 'fail'));
test('DNS rebinding answer is blocked before any socket call', async () => { let called = false; const r = await run({ url: 'https://example.com' }, response(), { dependencies: { resolveHost: async () => [{ address: '127.0.0.1', family: 4 }], fetchOne: async () => { called = true; } } }); assert.equal(called, false); assert.deepEqual(r.reasons, ['ADDRESS_BLOCKED']); });
test('redirect to metadata is blocked before a second fetch', async () => { let count = 0; const r = await run({ url: 'https://example.com' }, response(), { dependencies: { fetchOne: async () => { count++; return response('', { status: 302, location: 'https://169.254.169.254/latest/meta-data/' }); } } }); assert.equal(count, 1); assert.deepEqual(r.reasons, ['ADDRESS_BLOCKED']); });
test('redirect target is resolved and pinned independently', async () => { const hosts = []; const r = await run({ url: 'https://example.com' }, response(), { dependencies: { resolveHost: async host => { hosts.push(host); return publicResolver(); }, fetchOne: async target => target.hostname === 'example.com' ? response('', { status: 302, location: 'https://example.org/done' }) : response() } }); assert.equal(r.verdict, 'pass'); assert.deepEqual(hosts, ['example.com', 'example.org']); assert.equal(r.hops.length, 2); });
test('HTTPS downgrade remains blocked even with HTTP opt-in', async () => { const r = await run({ url: 'https://example.com' }, response('', { status: 302, location: 'http://example.org' }), { config: { allowHttp: true } }); assert.deepEqual(r.reasons, ['TLS_DOWNGRADE_BLOCKED']); });
test('redirect loops terminate at the configured limit', async () => { const r = await run({ url: 'https://example.com' }, response('', { status: 302, location: '/again' }), { config: { maxRedirects: 1 } }); assert.deepEqual(r.reasons, ['REDIRECT_LIMIT']); assert.equal(r.hops.length, 2); });
test('deadline cancels an in-flight transport', async () => { const r = await run({ url: 'https://example.com' }, response(), { config: { timeoutMs: 30 }, dependencies: { fetchOne: async (_t, _a, { signal }) => new Promise((_res, reject) => { const live = setTimeout(() => {}, 1000); signal.addEventListener('abort', () => { clearTimeout(live); reject(new Error('cancelled')); }); }) } }); assert.deepEqual(r.reasons, ['PROBE_TIMEOUT']); assert.equal(r.verdict, 'inconclusive'); });
test('TLS validation errors are not falsely called successful HTTP checks', async () => { const r = await run({ url: 'https://example.com' }, response(), { dependencies: { fetchOne: async () => { throw Object.assign(new Error('private error'), { code: 'CERT_HAS_EXPIRED' }); } } }); assert.deepEqual(r.reasons, ['TLS_VALIDATION_FAILED']); assert.ok(!JSON.stringify(r).includes('private error')); });
test('pinned lookup supports Node all and scalar signatures', () => { const lookup = pinnedLookup({ address: '8.8.8.8', family: 4 }); lookup('attacker.test', { all: true }, (_e, values) => assert.deepEqual(values, [{ address: '8.8.8.8', family: 4 }])); lookup('attacker.test', {}, (_e, value, family) => { assert.equal(value, '8.8.8.8'); assert.equal(family, 4); }); });
test('real HTTP transport pins address, preserves Host, bounds body and sends no credentials', async t => {
  let observed;
  const server = http.createServer((req, res) => { observed = req.headers; res.writeHead(200, { 'content-type': 'text/plain' }); res.end('x'.repeat(5000)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.onTestFinished(() => { server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  // Test seam deliberately bypasses public URL policy; production routes never do.
  const r = await fetchPinned({ url: new URL(`http://no-dns-needed.example:${port}`) }, { address: '127.0.0.1', family: 4 }, { signal: AbortSignal.timeout(1000), maxBodyBytes: 1024 });
  assert.equal(r.body.length, 1024); assert.equal(r.complete, false); assert.equal(observed.host, `no-dns-needed.example:${port}`); assert.equal(observed.authorization, undefined); assert.equal(observed.cookie, undefined); assert.equal(observed['accept-encoding'], 'identity');
});
test('JSON Pointer never traverses inherited properties or array pseudo-properties', () => { assert.equal(jsonPointer({}, '/constructor').found, false); assert.equal(jsonPointer(['a'], '/length').found, false); assert.equal(jsonPointer(['a'], '/00').found, false); assert.equal(jsonPointer(null, '').value, null); });
for (const input of [null, [], { url: 'x', headers: {} }, { url: 'x', detail: 'giant' }, { url: 'x', assert: { status: 0 } }, { url: 'x', assert: { text_contains: '' } }, { url: 'x', assert: { json: { pointer: 'bad', equals: 1 } } }, { url: 'x', assert: { json: { pointer: '/a~2b', equals: 1 } } }, { url: 'x', assert: { json: { pointer: '/x', equals: {} } } }]) test(`reject malformed verification input ${JSON.stringify(input)}`, () => assert.throws(() => validateInput(input), { code: 'INVALID_INPUT' }));

for (const input of [{url:'x', detail:null}, {url:'x', assert:null}, {url:'x', assert:{status:null}}]) test(`reject explicit null input ${JSON.stringify(input)}`, () => assert.throws(() => validateInput(input)));

test('UTF-8 charset with optional whitespace and quotes is accepted', async () => {
  for (const content_type of ['text/html; charset = utf-8', 'text/html; charset="UTF-8"', 'text/plain; charset= utf8']) {
    const r = await run({url:'https://example.com', assert:{text_contains:'hello'}},response('hello',{content_type}));
    assert.equal(r.verdict,'pass',content_type);
  }
});
