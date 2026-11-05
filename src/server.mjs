import http from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { authenticate } from './config.mjs';
import { AppError, errorBody, safeError } from './errors.mjs';
import { FixedWindowLimiter } from './service.mjs';
import { handleMcp, MCP_VERSIONS } from './mcp.mjs';
import { renderPage, publicPaths, robots, sitemap, llms } from './site.mjs';
import { openapi } from './openapi.mjs';

function send(response, status, value, type = 'application/json; charset=utf-8') {
  if (response.destroyed || response.writableEnded) return;
  const body = value === undefined ? '' : type.startsWith('application/json') ? JSON.stringify(value) : value;
  response.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
  response.end(body);
}
export async function readJson(request, max = 16384) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json.', 415);
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') throw new AppError('UNSUPPORTED_ENCODING', 'Compressed request bodies are not accepted.', 415);
  const declared = Number(request.headers['content-length'] || 0);
  if (declared > max) throw new AppError('BODY_TOO_LARGE', 'The maximum request body is 16384 bytes.', 413);
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let settled = false;
    const timer = setTimeout(() => finish(new AppError('REQUEST_TIMEOUT', 'Request body deadline exceeded.', 408)), 5000);
    timer.unref();
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      request.removeListener('data', onData); request.removeListener('end', onEnd);
      request.removeListener('error', onError); request.removeListener('aborted', onAborted);
      // Drain without buffering until the error response closes the connection.
      if (error) { request.once('error', () => {}); request.resume(); reject(error); } else resolve(value);
    };
    const onData = chunk => {
      size += chunk.length;
      if (size > max) return finish(new AppError('BODY_TOO_LARGE', 'The maximum request body is 16384 bytes.', 413));
      chunks.push(chunk);
    };
    const onEnd = () => {
      try { finish(null, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { finish(new AppError('INVALID_JSON', 'Supply a valid UTF-8 JSON body.')); }
    };
    const onError = () => finish(new AppError('REQUEST_INTERRUPTED', 'Request body was interrupted.', 400));
    const onAborted = () => finish(new AppError('REQUEST_INTERRUPTED', 'Request body was interrupted.', 400));
    request.on('data', onData); request.on('end', onEnd); request.on('error', onError); request.on('aborted', onAborted);
  });
}
export async function createServer(config, service, { log = entry => console.log(JSON.stringify(entry)) } = {}) {
  const assets = new Map();
  for (const [name, mime] of [['style.css', 'text/css'], ['site.js', 'text/javascript'], ['favicon.svg', 'image/svg+xml']]) assets.set(`/${name}`, { body: await readFile(fileURLToPath(new URL(`../public/${name}`, import.meta.url))), mime });
  const limiter = new FixedWindowLimiter(config.requestsPerMinute);
  const spec = openapi(config);
  const server = http.createServer({ maxHeaderSize: 16384, requestTimeout: 10000, headersTimeout: 8000, keepAliveTimeout: 5000, connectionsCheckingInterval: 1000 }, (request, response) => {
    const id = randomUUID();
    let route = 'unknown';
    const nonce = randomBytes(16).toString('base64');
    response.setHeader('x-request-id', id);
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('content-security-policy', `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    response.on('finish', () => log({ event: 'http_request', request_id: id, route, method: request.method, status: response.statusCode }));
    void (async () => {
      if (!request.url || request.url.length > 4096 || !request.url.startsWith('/')) throw new AppError('INVALID_REQUEST_TARGET', 'A bounded origin-form request target is required.', 400);
      const url = new URL(request.url, config.baseUrl);
      const path = url.pathname;
      const publicHost = new URL(config.baseUrl).host;
      const local = [`localhost:${request.socket.localPort}`, `127.0.0.1:${request.socket.localPort}`, `[::1]:${request.socket.localPort}`];
      if (![publicHost, ...local].includes(request.headers.host)) throw new AppError('HOST_REJECTED', 'Unrecognized Host header.', 403);
      if (request.headers.origin && request.headers.origin !== config.baseUrl) throw new AppError('ORIGIN_REJECTED', 'Unrecognized Origin header.', 403);
      if (path.startsWith('/v1/') || path === '/mcp' || path === '/healthz' || new URL(config.baseUrl).protocol === 'http:') response.setHeader('x-robots-tag', 'noindex, nofollow');
      const protectedRoute = path === '/mcp' || (path.startsWith('/v1/') && path !== '/v1/capabilities');
      let owner;
      if (protectedRoute) {
        owner = authenticate(request.headers.authorization, config.keys);
        if (!owner) {
          response.setHeader('www-authenticate', 'Bearer realm="agent-reality-api"');
          throw new AppError('UNAUTHORIZED', 'A valid service bearer key is required.', 401);
        }
        limiter.consume(owner);
      }
      if (path === '/mcp') {
        route = 'mcp';
        if (request.method !== 'POST') { response.setHeader('allow', 'POST'); throw new AppError('METHOD_NOT_ALLOWED', 'This stateless MCP endpoint only accepts POST; it has no SSE session.', 405); }
        const accept = request.headers.accept || '';
        if (!accept.includes('application/json') || !accept.includes('text/event-stream')) throw new AppError('NOT_ACCEPTABLE', 'MCP clients must accept application/json and text/event-stream.', 406);
        const version = request.headers['mcp-protocol-version'];
        if (version && !MCP_VERSIONS.includes(version)) throw new AppError('PROTOCOL_NOT_SUPPORTED', 'Negotiate one of the advertised MCP protocol versions.', 400);
        let body;
        try { body = await readJson(request); } catch (e) {
          if (e.code === 'INVALID_JSON') return send(response, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
          throw e;
        }
        const result = await handleMcp(body, owner, service);
        return send(response, result.status, result.body);
      }
      if (path === '/v1/verify/website') {
        route = 'verify_website';
        if (request.method !== 'POST') { response.setHeader('allow', 'POST'); throw new AppError('METHOD_NOT_ALLOWED', 'Use POST.', 405); }
        return send(response, 200, await service.verify(owner, await readJson(request)));
      }
      if (path.startsWith('/v1/evidence/')) {
        route = 'get_evidence';
        if (request.method !== 'GET') { response.setHeader('allow', 'GET'); throw new AppError('METHOD_NOT_ALLOWED', 'Use GET.', 405); }
        const detail = url.searchParams.get('detail') ?? 'full';
        if (!['compact', 'standard', 'full'].includes(detail) || [...url.searchParams.keys()].some(k => k !== 'detail') || url.searchParams.getAll('detail').length > 1) throw new AppError('INVALID_INPUT', 'Supply one valid detail parameter.');
        return send(response, 200, await service.evidence(owner, path.slice('/v1/evidence/'.length), detail));
      }
      if (!['GET', 'HEAD'].includes(request.method)) { response.setHeader('allow', 'GET, HEAD'); throw new AppError('METHOD_NOT_ALLOWED', 'Use GET or HEAD for public resources.', 405); }
      // Node suppresses response bodies for HEAD while preserving GET headers.
      if (path === '/healthz') { route = 'healthz'; return send(response, 200, { status: 'ok', version: '0.2.0', runtime: process.versions.bun ? 'bun' : 'node', runtime_version: process.versions.bun || process.versions.node }); }
      if (path === '/v1/capabilities') { route = 'capabilities'; return send(response, 200, service.capabilities()); }
      if (path === '/openapi.json') { route = 'openapi'; return send(response, 200, spec); }
      if (path === '/agent.json') { route = 'agent_manifest'; return send(response, 200, { name: 'Agent Reality API', manifest_status: 'project_specific_not_a_universal_standard', description: 'Evidence-first, bounded website verification.', api: `${config.baseUrl}/openapi.json`, mcp: `${config.baseUrl}/mcp`, docs: `${config.baseUrl}/docs`, auth: 'operator-issued bearer key', scope: 'single-vantage HTTP observations only' }); }
      if (path === '/robots.txt') { route = 'robots'; return send(response, 200, robots(config), 'text/plain; charset=utf-8'); }
      if (path === '/sitemap.xml') { route = 'sitemap'; return send(response, 200, sitemap(config), 'application/xml; charset=utf-8'); }
      if (path === '/llms.txt' || path === '/llms-full.txt') { route = 'llms'; return send(response, 200, llms(config, path.endsWith('full.txt')), 'text/plain; charset=utf-8'); }
      if (assets.has(path)) { route = 'static'; const asset = assets.get(path); response.setHeader('cache-control', 'public, max-age=3600'); return send(response, 200, asset.body, asset.mime); }
      if (publicPaths.includes(path)) { route = 'documentation'; response.setHeader('cache-control', 'public, max-age=300'); return send(response, 200, renderPage(path, config, nonce), 'text/html; charset=utf-8'); }
      throw new AppError('NOT_FOUND', 'Resource not found.', 404);
    })().catch(error => {
      const e = safeError(error);
      if ([429, 503].includes(e.status)) response.setHeader('retry-after', '60');
      if ([400, 401, 403, 408, 413, 415].includes(e.status)) response.setHeader('connection', 'close');
      if (e.status === 500) log({ event: 'internal_error', request_id: id, code: e.code });
      send(response, e.status, errorBody(e, id));
    });
  });
  server.maxConnections = 100;
  server.maxHeadersCount = 60;
  server.maxRequestsPerSocket = 100;
  return server;
}
