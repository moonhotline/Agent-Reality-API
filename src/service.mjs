import { randomUUID } from 'node:crypto';
import { AppError } from './errors.mjs';
import { validateInput } from './schema.mjs';
import { parseTarget } from './policy.mjs';
import { probeWebsite } from './probe.mjs';

export class FixedWindowLimiter {
  constructor(limit, clock = Date.now) { this.limit = limit; this.clock = clock; this.windows = new Map(); }
  consume(key) {
    const now = this.clock();
    let entry = this.windows.get(key);
    if (!entry || entry.until <= now) { entry = { count: 0, until: now + 60000 }; this.windows.set(key, entry); }
    if (entry.count >= this.limit) throw new AppError('RATE_LIMITED', 'Client quota exceeded. Retry after 60 seconds.', 429, true);
    entry.count++;
  }
}
export function presentEvidence(envelope, detail = 'compact') {
  const r = envelope.record;
  const compact = {
    schema_version: r.schema_version, evidence_id: r.evidence_id,
    observed_at: r.observed_at, expires_at: r.expires_at,
    verdict: r.verdict, ok: r.ok, reasons: r.reasons, retryable: r.retryable,
    http_status: r.response?.status ?? null, duration_ms: r.duration_ms,
    scope: 'single-node HTTP observation, not browser or global availability proof',
    evidence_path: `/v1/evidence/${r.evidence_id}`
  };
  if (detail === 'compact') return compact;
  if (detail === 'standard') return { ...compact, final_url: r.final_url, vantage: r.vantage, checks: r.checks, limitations: r.limitations, integrity: envelope.integrity };
  return { ...compact, record: r, integrity: envelope.integrity };
}
export class VerificationService {
  constructor(config, store, dependencies = {}) {
    this.config = config; this.store = store; this.dependencies = dependencies;
    this.active = 0; this.clientActive = new Map();
    this.limiter = new FixedWindowLimiter(config.probesPerMinute);
  }
  capabilities() {
    return {
      name: 'Agent Reality API', version: '0.2.0', schema_version: '1.0',
      tools: ['verify_website', 'get_evidence'],
      outputs: ['compact', 'standard', 'full'],
      assertions: ['http_status', 'raw_utf8_text_contains', 'json_pointer_scalar_equals'],
      limits: { timeout_ms: this.config.timeoutMs, response_bytes: this.config.maxBodyBytes, redirects: this.config.maxRedirects, evidence_ttl_seconds: this.config.evidenceTtlMs / 1000 },
      guarantees: ['bounded_requests', 'private_evidence_by_client_id'],
      not_supported: ['browser_javascript', 'authenticated_targets', 'query_strings', 'arbitrary_ports', 'continuous_monitoring', 'multi_region_consensus', 'OAuth_discovery', 'remote_code_execution'],
      machine_docs: { openapi: '/openapi.json', mcp: '/mcp', llms: '/llms.txt' }
    };
  }
  async verify(owner, raw) {
    const input = validateInput(raw);
    parseTarget(input.url, this.config);
    this.limiter.consume(owner);
    const clientCount = this.clientActive.get(owner) || 0;
    if (this.active >= this.config.concurrency || clientCount >= this.config.clientConcurrency) throw new AppError('SERVICE_BUSY', 'Probe concurrency is full. Retry with jitter.', 503, true);
    this.active++; this.clientActive.set(owner, clientCount + 1);
    try {
      const startedAt = new Date().toISOString();
      const observation = await probeWebsite(input, this.config, this.dependencies);
      const record = {
        schema_version: '1.0', evidence_id: randomUUID(), started_at: startedAt,
        observed_at: new Date().toISOString(), expires_at: new Date(Date.now() + this.config.evidenceTtlMs).toISOString(),
        vantage: this.config.vantage, request: { url: input.url, assert: input.assert }, ...observation
      };
      return presentEvidence(await this.store.save(owner, record), input.detail);
    } finally {
      this.active--; this.clientActive.set(owner, (this.clientActive.get(owner) || 1) - 1);
    }
  }
  async evidence(owner, id, detail = 'full') { return presentEvidence(await this.store.get(owner, id), detail); }
}
