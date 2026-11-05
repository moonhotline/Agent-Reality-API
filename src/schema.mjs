import { AppError } from './errors.mjs';
export const verifySchema = {
  type: 'object', additionalProperties: false, required: ['url'],
  properties: {
    url: { type: 'string', format: 'uri', maxLength: 2048, description: 'Public HTTPS URL, default port only. No credentials, query or fragment.' },
    detail: { type: 'string', enum: ['compact', 'standard', 'full'], default: 'compact' },
    assert: {
      type: 'object', additionalProperties: false,
      properties: {
        status: { type: 'integer', minimum: 100, maximum: 599, default: 200 },
        text_contains: { type: 'string', minLength: 1, maxLength: 512, description: 'Literal case-sensitive match against raw UTF-8 HTTP source; NOT rendered browser text.' },
        json: {
          type: 'object', additionalProperties: false, required: ['pointer', 'equals'],
          properties: {
            pointer: { type: 'string', maxLength: 256, description: 'RFC 6901 JSON Pointer; empty string selects the root.' },
            equals: { type: ['string', 'number', 'boolean', 'null'], maxLength: 512 }
          }
        }
      }
    }
  }
};
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fields(value, allowed) { return Object.keys(value).every(key => allowed.includes(key)); }
export function validateInput(input) {
  if (!object(input) || !fields(input, ['url', 'detail', 'assert']) || typeof input.url !== 'string' || input.url.length > 2048) throw new AppError('INVALID_INPUT', 'Expected url, optional assert, and optional detail. Unknown fields are rejected.');
  const detail = input.detail === undefined ? 'compact' : input.detail;
  if (!['compact', 'standard', 'full'].includes(detail)) throw new AppError('INVALID_INPUT', 'detail must be compact, standard or full.');
  const assertions = input.assert === undefined ? {} : input.assert;
  if (!object(assertions) || !fields(assertions, ['status', 'text_contains', 'json'])) throw new AppError('INVALID_INPUT', 'Unsupported assertion.');
  const status = assertions.status === undefined ? 200 : assertions.status;
  if (!Number.isInteger(status) || status < 100 || status > 599) throw new AppError('INVALID_INPUT', 'Expected status must be 100-599.');
  if (assertions.text_contains !== undefined && (typeof assertions.text_contains !== 'string' || !assertions.text_contains.length || assertions.text_contains.length > 512)) throw new AppError('INVALID_INPUT', 'text_contains must be 1-512 characters.');
  if (assertions.json !== undefined) {
    const j = assertions.json;
    if (!object(j) || !fields(j, ['pointer', 'equals']) || typeof j.pointer !== 'string' || j.pointer.length > 256 || !Object.hasOwn(j, 'equals') || (j.pointer !== '' && !j.pointer.startsWith('/')) || /~(?![01])/.test(j.pointer)) throw new AppError('INVALID_INPUT', 'json requires a valid JSON Pointer and a scalar equals value.');
    if (j.equals !== null && !['string', 'number', 'boolean'].includes(typeof j.equals)) throw new AppError('INVALID_INPUT', 'json.equals must be a scalar.');
    if ((typeof j.equals === 'string' && j.equals.length > 512) || (typeof j.equals === 'number' && !Number.isFinite(j.equals))) throw new AppError('INVALID_INPUT', 'json.equals is too large or not finite.');
  }
  return { url: input.url, detail, assert: { ...assertions, status } };
}
export function jsonPointer(value, pointer) {
  if (pointer === '') return { found: true, value };
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key) || (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key))) return { found: false };
    value = value[key];
  }
  return { found: true, value };
}
