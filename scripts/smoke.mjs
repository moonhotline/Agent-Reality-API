import assert from 'node:assert/strict';
const base = (process.env.REALITY_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const key = process.env.REALITY_API_KEY;
if (!key) throw new Error('Set REALITY_API_KEY to the secret portion of an API_KEYS entry.');
const get = async path => {
  const r = await fetch(base + path, { signal: AbortSignal.timeout(15000) });
  assert.equal(r.status, 200, `${path} returned ${r.status}`); return r;
};
await get('/healthz');
const api = await (await get('/openapi.json')).json(); assert.equal(api.openapi, '3.1.0');
for (const path of ['/', '/docs', '/robots.txt', '/sitemap.xml', '/llms.txt']) await get(path);
const rpc = async (method, params, id = 1) => {
  const r = await fetch(base + '/mcp', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(15000) });
  assert.equal(r.status, 200); const json = await r.json(); assert.ok(!json.error, JSON.stringify(json.error)); return json.result;
};
await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'reality-smoke', version: '1.0' } });
const list = await rpc('tools/list', {}); assert.equal(list.tools.length, 2);
const blocked = await fetch(base + '/v1/verify/website', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://127.0.0.1' }) });
assert.equal(blocked.status, 400);
if (process.env.SMOKE_TARGET_URL) {
  const r = await fetch(base + '/v1/verify/website', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ url: process.env.SMOKE_TARGET_URL, detail: 'standard' }), signal: AbortSignal.timeout(15000) });
  assert.equal(r.status, 200); const result = await r.json();
  console.log(JSON.stringify({ live_target_verdict: result.verdict, evidence_id: result.evidence_id, reasons: result.reasons }));
  assert.equal(result.verdict, 'pass', 'The real target did not pass. Inspect its evidence record.');
}
console.log('Service and MCP protocol smoke checks passed. Live target probing runs only when SMOKE_TARGET_URL is set.');
