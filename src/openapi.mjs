import { verifySchema } from './schema.mjs';

const error = {
  type: 'object', required: ['error', 'request_id'],
  properties: {
    error: { type: 'object', required: ['code', 'message', 'retryable'], properties: { code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' } } },
    request_id: { type: 'string', format: 'uuid' }
  }
};
const compact = {
  type: 'object', required: ['schema_version', 'evidence_id', 'observed_at', 'expires_at', 'verdict', 'ok', 'reasons', 'retryable', 'http_status', 'duration_ms', 'scope', 'evidence_path'],
  properties: {
    schema_version: { type: 'string', const: '1.0' }, evidence_id: { type: 'string', format: 'uuid' },
    observed_at: { type: 'string', format: 'date-time' }, expires_at: { type: 'string', format: 'date-time' },
    verdict: { type: 'string', enum: ['pass', 'fail', 'inconclusive'] }, ok: { type: ['boolean', 'null'], description: 'null means inconclusive, never success.' },
    reasons: { type: 'array', items: { type: 'string' } }, retryable: { type: 'boolean' }, http_status: { type: ['integer', 'null'] },
    duration_ms: { type: 'integer' }, scope: { type: 'string' }, evidence_path: { type: 'string' },
    final_url: { type: 'string' }, vantage: { type: 'string' }, checks: { type: 'array', items: { type: 'object' } }, limitations: { type: 'array', items: { type: 'string' } },
    record: { type: 'object', description: 'Full immutable observation; see the evidence contract in /docs/verify.' }, integrity: { type: 'object', properties: { algorithm: { const: 'sha256' }, digest: { type: 'string' }, scope: { type: 'string' }, attestation: { const: false } } }
  }
};
const jsonResponse = (description, schema) => ({ description, content: { 'application/json': { schema } } });
const errors = Object.fromEntries([400, 401, 403, 404, 405, 413, 415, 429, 500, 503].map(status => [String(status), jsonResponse(`Request or service error (${status}); inspect error.code.`, { $ref: '#/components/schemas/Error' })]));
export function openapi(config) {
  return {
    openapi: '3.1.0',
    info: { title: 'Agent Reality API', version: '0.2.0', summary: 'Evidence-first website verification for AI agents', description: 'One bounded public-network observation. Not a browser, a multi-region uptime guarantee, or a cryptographic attestation. Authenticated REST and a separate MCP Streamable HTTP endpoint.', license: { name: 'MIT', identifier: 'MIT' } },
    servers: [{ url: config.baseUrl }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/healthz': { get: { operationId: 'health', security: [], summary: 'Process liveness; not a target check', responses: { 200: jsonResponse('Process is running', { type: 'object', properties: { status: { const: 'ok' }, version: { type: 'string' } } }) } } },
      '/v1/capabilities': { get: { operationId: 'capabilities', security: [], summary: 'Discover supported capabilities and configured limits', responses: { 200: jsonResponse('Capabilities', { type: 'object' }) } } },
      '/v1/verify/website': {
        post: { operationId: 'verifyWebsite', summary: 'Verify a public endpoint and save a private evidence record', description: 'Only HTTP 200 means the API completed; inspect verdict for the verification result. Repeated calls create new observations and consume quota.', requestBody: { required: true, content: { 'application/json': { schema: verifySchema, example: { url: 'https://example.com/', assert: { status: 200, text_contains: 'Example Domain' }, detail: 'compact' } } } }, responses: { 200: jsonResponse('A completed observation (pass, fail or inconclusive)', { $ref: '#/components/schemas/Verification' }), ...errors } }
      },
      '/v1/evidence/{evidence_id}': {
        get: { operationId: 'getEvidence', summary: 'Read private saved evidence; uses the same client ID', parameters: [{ name: 'evidence_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'detail', in: 'query', schema: { type: 'string', enum: ['compact', 'standard', 'full'], default: 'full' } }], responses: { 200: jsonResponse('Stored observation; no new probe occurs', { $ref: '#/components/schemas/Verification' }), ...errors } }
      }
    },
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'An operator-issued random secret; not a model provider key. Send only to this service.' } }, schemas: { VerifyRequest: verifySchema, Verification: compact, Error: error } },
    externalDocs: { url: `${config.baseUrl}/docs`, description: 'Integration, security and evidence semantics' }
  };
}
