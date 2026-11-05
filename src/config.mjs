import { resolve } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';

const integer = (env, name, fallback, min, max) => {
  const value = env[name] === undefined || env[name] === '' ? fallback : Number(env[name]);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
};
export const digest = value => createHash('sha256').update(value).digest();
export function loadConfig(env = process.env) {
  const rawKeys = (env.API_KEYS ?? '').split(',').filter(Boolean);
  if (!rawKeys.length || rawKeys.length > 32) throw new Error('Set API_KEYS to 1-32 client-id:secret pairs. Run pnpm env:init first.');
  const ids = new Set();
  const hashes = new Set();
  const keys = rawKeys.map(pair => {
    const i = pair.indexOf(':');
    const id = pair.slice(0, i);
    const secret = pair.slice(i + 1);
    if (i < 1 || !/^[a-zA-Z0-9_-]{1,40}$/.test(id) || !/^[a-zA-Z0-9_-]{32,128}$/.test(secret) || /replace|change|example/i.test(secret)) {
      throw new Error('Each API key must have a unique safe client ID and a random 32-128 character secret.');
    }
    const hash = digest(secret);
    if (ids.has(id) || hashes.has(hash.toString('hex'))) throw new Error('Duplicate API key ID or secret');
    ids.add(id); hashes.add(hash.toString('hex'));
    return { id, hash };
  });
  const port = integer(env, 'PORT', 8080, 1, 65535);
  const base = new URL(env.PUBLIC_BASE_URL || `http://localhost:${port}`);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('PUBLIC_BASE_URL must be a plain http(s) origin.');
  const production = env.NODE_ENV === 'production';
  if (production && base.protocol !== 'https:') throw new Error('Production requires an HTTPS PUBLIC_BASE_URL.');
  if (env.ALLOW_HTTP && !['true', 'false'].includes(env.ALLOW_HTTP)) throw new Error('ALLOW_HTTP must be true or false');
  return {
    keys, port, host: env.HOST || '127.0.0.1', production,
    baseUrl: base.origin,
    allowedHosts: (env.ALLOWED_TARGET_HOSTS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean),
    deniedCidrs: (env.DENIED_CIDRS || '').split(',').map(x => x.trim()).filter(Boolean),
    allowHttp: env.ALLOW_HTTP === 'true',
    dataDir: resolve(env.DATA_DIR || './data'),
    vantage: (env.VANTAGE_LABEL || 'self-hosted-single-node').slice(0, 120),
    timeoutMs: integer(env, 'PROBE_TIMEOUT_MS', 8000, 500, 15000),
    maxBodyBytes: integer(env, 'MAX_RESPONSE_BYTES', 262144, 1024, 1048576),
    maxRedirects: integer(env, 'MAX_REDIRECTS', 3, 0, 5),
    concurrency: integer(env, 'MAX_CONCURRENT_PROBES', 4, 1, 16),
    clientConcurrency: integer(env, 'MAX_CLIENT_CONCURRENCY', 2, 1, 8),
    requestsPerMinute: integer(env, 'REQUESTS_PER_MINUTE', 120, 1, 600),
    probesPerMinute: integer(env, 'PROBES_PER_MINUTE', 20, 1, 120),
    evidenceTtlMs: integer(env, 'EVIDENCE_TTL_SECONDS', 86400, 60, 604800) * 1000,
    maxEvidence: integer(env, 'MAX_EVIDENCE_RECORDS', 2000, 1, 20000),
    maxClientEvidence: integer(env, 'MAX_CLIENT_EVIDENCE_RECORDS', 200, 1, 2000)
  };
}
export function authenticate(header, keys) {
  if (typeof header !== 'string' || header.length > 150 || !/^Bearer /i.test(header)) return null;
  const incoming = digest(header.slice(7));
  let match = null;
  for (const key of keys) if (timingSafeEqual(incoming, key.hash)) match = key.id;
  return match;
}
