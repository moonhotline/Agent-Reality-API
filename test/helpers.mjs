import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { EvidenceStore } from '../src/store.mjs';
import { VerificationService } from '../src/service.mjs';
import { createServer } from '../src/server.mjs';
export const KEY_A = 'a'.repeat(64);
export const KEY_B = 'b'.repeat(64);
export function config(extra = {}) {
  return { ...loadConfig({ API_KEYS: `alice:${KEY_A},bob:${KEY_B}`, PUBLIC_BASE_URL: 'http://localhost:8080' }), ...extra };
}
export function response(body = 'hello release:v1', extra = {}) {
  return { status: 200, content_type: 'text/plain; charset=utf-8', content_encoding: 'identity', body: Buffer.from(body), complete: true, headers: { 'content-type': 'text/plain; charset=utf-8' }, tls: { authorized: true, protocol: 'TLSv1.3' }, ...extra };
}
export const publicResolver = async () => [{ address: '8.8.8.8', family: 4 }];
export async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'reality-test-'));
  const cfg = config({ dataDir: dir, ...options.config });
  const store = await new EvidenceStore(cfg).init();
  const service = new VerificationService(cfg, store, { resolveHost: publicResolver, fetchOne: async () => response(), ...options.dependencies });
  const logs = [];
  const server = await createServer(cfg, service, { log: item => logs.push(item) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.onTestFinished(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close(); await rm(dir, { recursive: true, force: true }); });
  const call = async (path, { key = KEY_A, body, headers = {}, method } = {}) => {
    const result = await fetch(base + path, { method: method || (body !== undefined ? 'POST' : 'GET'), headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
    const text = await result.text();
    let json; try { json = JSON.parse(text); } catch { /* HTML or empty */ }
    return { status: result.status, headers: result.headers, text, json };
  };
  return { cfg, store, service, server, base, call, logs, dir };
}
