import { loadConfig } from './config.mjs';
import { inCidr } from './policy.mjs';
import { EvidenceStore } from './store.mjs';
import { VerificationService } from './service.mjs';
import { createServer } from './server.mjs';

try {
  const config = loadConfig();
  for (const cidr of config.deniedCidrs) inCidr('8.8.8.8', cidr);
  const store = await new EvidenceStore(config).init();
  const service = new VerificationService(config, store);
  const server = await createServer(config, service);
  server.listen(config.port, config.host, () => console.log(JSON.stringify({ event: 'listening', host: config.host, port: config.port, version: '0.2.0' })));
  server.on('error', error => { console.error(JSON.stringify({ event: 'server_error', code: error.code || 'UNKNOWN' })); process.exitCode = 1; void store.close(); });
  let closing = false;
  const shutdown = () => {
    if (closing) return; closing = true;
    const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 20000);
    deadline.unref();
    server.close(async () => { await store.close(); clearTimeout(deadline); });
    server.closeIdleConnections();
  };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
} catch (error) {
  console.error(JSON.stringify({ event: 'startup_failed', message: error.message }));
  process.exitCode = 1;
}
