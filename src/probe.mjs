import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { AppError } from './errors.mjs';
import { parseTarget, resolvePublic, validateAddresses } from './policy.mjs';
import { jsonPointer } from './schema.mjs';

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const short = value => typeof value === 'string' ? value.slice(0, 256) : null;
export function pinnedLookup(address) {
  return (_hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (options?.all) callback(null, [{ address: address.address, family: address.family }]);
    else callback(null, address.address, address.family);
  };
}
// All outbound HTTP travels through this one transport. It never uses an env proxy,
// forwards credentials, follows redirects itself, or resolves the host a second time.
export function fetchPinned(target, address, { signal, maxBodyBytes }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve(value);
    };
    const transport = target.url.protocol === 'https:' ? https : http;
    const request = transport.request(target.url, {
      method: 'GET', agent: false, family: address.family, autoSelectFamily: false,
      lookup: pinnedLookup(address), signal, maxHeaderSize: 16384,
      rejectUnauthorized: true,
      headers: {
        'user-agent': 'AgentRealityAPI/0.2 (+https://github.com/moonhotline/test_repo)',
        accept: 'application/json,text/html,text/plain;q=0.9,*/*;q=0.1',
        'accept-encoding': 'identity', connection: 'close'
      }
    }, response => {
      const socket = response.socket;
      let tls = null;
      if (target.url.protocol === 'https:') {
        const cert = socket.getPeerCertificate();
        tls = {
          authorized: socket.authorized === true,
          protocol: socket.getProtocol(),
          subject_cn: short(cert.subject?.CN), issuer_cn: short(cert.issuer?.CN),
          valid_from: short(cert.valid_from), valid_to: short(cert.valid_to),
          fingerprint_sha256: short(cert.fingerprint256)
        };
      }
      const meta = {
        status: response.statusCode,
        content_type: short(response.headers['content-type']),
        content_encoding: short(response.headers['content-encoding'])?.trim().toLowerCase() || 'identity',
        location: response.headers.location,
        tls,
        remote_address: socket.remoteAddress,
        headers: Object.fromEntries(['content-type', 'content-length', 'date', 'etag', 'last-modified', 'cache-control'].filter(h => typeof response.headers[h] === 'string').map(h => [h, response.headers[h].slice(0, 256)]))
      };
      if (REDIRECTS.has(meta.status)) {
        done(null, { ...meta, body: Buffer.alloc(0), complete: false, body_skipped: true });
        response.destroy(); return;
      }
      let size = 0;
      const parts = [];
      response.on('data', chunk => {
        const remaining = maxBodyBytes - size;
        if (remaining > 0) { parts.push(chunk.subarray(0, remaining)); size += Math.min(chunk.length, remaining); }
        if (chunk.length > remaining) {
          done(null, { ...meta, body: Buffer.concat(parts), complete: false });
          response.destroy();
        }
      });
      response.on('end', () => done(null, { ...meta, body: Buffer.concat(parts), complete: response.complete }));
      response.on('error', error => done(error));
      response.on('aborted', () => done(new AppError('RESPONSE_INTERRUPTED', 'The response ended before a complete body was received.', 422, true)));
    });
    request.on('error', error => done(error));
    request.end();
  });
}
function classifyNetworkError(error, signal) {
  if (signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') return new AppError('PROBE_TIMEOUT', 'The overall observation deadline expired.', 422, true);
  if (error instanceof AppError) return error;
  const code = String(error?.code || '');
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return new AppError('TLS_VALIDATION_FAILED', 'A valid authenticated TLS connection could not be established.', 422, false);
  return new AppError('NETWORK_UNREACHABLE', 'The target could not be observed from this node; this does not prove a global outage.', 422, true);
}
function contentChecks(response, assertions) {
  const checks = [];
  let text;
  const charset = response.content_type?.match(/(?:^|;)\s*charset\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
  const utf8 = !charset || ['utf-8', 'utf8', 'us-ascii'].includes((charset[1] || charset[2]).trim().toLowerCase());
  if (response.content_encoding === 'identity' && utf8) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(response.body); } catch { /* bounded prefix may split a codepoint */ }
  }
  if (assertions.text_contains !== undefined) {
    const found = text?.includes(assertions.text_contains);
    checks.push({ name: 'text_contains', state: found ? 'pass' : text === undefined || !response.complete ? 'unknown' : 'fail', expected: assertions.text_contains, observed: found ?? null, scope: 'raw_utf8_http_source' });
  }
  if (assertions.json) {
    let state = 'unknown';
    let observed = null;
    let reason = 'BODY_UNAVAILABLE_OR_INCOMPLETE';
    if (text !== undefined && response.complete) {
      try {
        const result = jsonPointer(JSON.parse(text), assertions.json.pointer);
        state = result.found && result.value === assertions.json.equals ? 'pass' : 'fail';
        // Never echo arbitrarily large or nested remote JSON into the agent context.
        observed = result.found && (result.value === null || ['boolean', 'number', 'string'].includes(typeof result.value)) ? (typeof result.value === 'string' ? result.value.slice(0, 512) : result.value) : null;
        reason = result.found ? 'JSON_VALUE_COMPARED' : 'JSON_POINTER_NOT_FOUND';
      } catch { state = 'fail'; reason = 'INVALID_JSON_BODY'; }
    }
    checks.push({ name: 'json_equals', state, pointer: assertions.json.pointer, expected: assertions.json.equals, observed, reason });
  }
  return checks;
}
export async function probeWebsite(input, config, dependencies = {}) {
  const resolveHost = dependencies.resolveHost || resolvePublic;
  const fetchOne = dependencies.fetchOne || fetchPinned;
  let target = parseTarget(input.url, config);
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  timer.unref?.();
  const signal = controller.signal;
  const hops = [];
  let phase = 'dns';
  try {
    for (let hop = 0; ; hop++) {
      signal.throwIfAborted();
      phase = 'dns';
      const addresses = validateAddresses(await resolveHost(target.hostname, config, signal), config);
      const chosen = addresses[0];
      phase = 'http';
      const response = await fetchOne(target, chosen, { signal, maxBodyBytes: config.maxBodyBytes });
      signal.throwIfAborted();
      hops.push({ url: target.url.href, resolved_addresses: addresses.map(a => a.address), connected_address: chosen.address, status: response.status, tls: response.tls });
      if (REDIRECTS.has(response.status)) {
        if (hop >= config.maxRedirects) throw new AppError('REDIRECT_LIMIT', 'The redirect limit was reached.', 422);
        if (typeof response.location !== 'string' || response.location.length > 2048) throw new AppError('INVALID_REDIRECT', 'The redirect has no valid bounded Location header.', 422);
        let next;
        try { next = new URL(response.location, target.url); } catch { throw new AppError('INVALID_REDIRECT', 'The redirect location is invalid.', 422); }
        if (target.url.protocol === 'https:' && next.protocol === 'http:') throw new AppError('TLS_DOWNGRADE_BLOCKED', 'HTTPS to HTTP redirects are not followed.');
        target = parseTarget(next.href, config);
        continue;
      }
      const checks = [
        { name: 'dns', state: 'pass', observed: addresses.map(a => a.address) },
        { name: 'tls', state: response.tls ? response.tls.authorized ? 'pass' : 'fail' : 'not_applicable', observed: response.tls?.authorized ?? null },
        { name: 'http_status', state: response.status === input.assert.status ? 'pass' : 'fail', expected: input.assert.status, observed: response.status },
        ...contentChecks(response, input.assert)
      ];
      const verdict = checks.some(c => c.state === 'fail') ? 'fail' : checks.some(c => c.state === 'unknown') ? 'inconclusive' : 'pass';
      const reasons = checks.filter(c => ['fail', 'unknown'].includes(c.state)).map(c => `${c.name.toUpperCase()}_${c.state === 'fail' ? 'MISMATCH' : 'UNKNOWN'}`);
      return {
        verdict, ok: verdict === 'inconclusive' ? null : verdict === 'pass', retryable: verdict === 'inconclusive', reasons,
        final_url: target.url.href, duration_ms: Math.round(performance.now() - started), checks, hops,
        response: { status: response.status, headers: response.headers, bytes_captured: response.body.length, complete: response.complete, content_encoding: response.content_encoding, sha256: createHash('sha256').update(response.body).digest('hex'), digest_scope: response.complete ? 'complete_response_body' : 'captured_prefix' },
        limitations: ['single_vantage_point', 'point_in_time_observation', 'http_source_only_no_javascript', 'selected_dns_address_only', 'external_content_is_untrusted_data', ...(!response.complete ? ['body_truncated'] : [])]
      };
    }
  } catch (error) {
    const e = classifyNetworkError(error, signal);
    return {
      verdict: 'inconclusive', ok: null, retryable: e.retryable, reasons: [e.code],
      final_url: hops.at(-1)?.url ?? input.url, duration_ms: Math.round(performance.now() - started),
      checks: [{ name: phase, state: 'unknown', reason: e.code }], hops,
      error: { code: e.code, message: e.message },
      limitations: ['single_vantage_point', 'point_in_time_observation', 'not_proof_of_global_outage', 'external_content_is_untrusted_data']
    };
  } finally { clearTimeout(timer); }
}
