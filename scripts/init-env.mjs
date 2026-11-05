import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--domain')) {
  console.error('Usage: bun scripts/init-env.mjs [--domain api.your-owned-domain.com]'); process.exit(1);
}
let domain = '';
if (args.length) {
  domain = args[1].toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) || domain.endsWith('.example')) {
    console.error('Supply a real owned domain, without a scheme, path, port or trailing dot.'); process.exit(1);
  }
}
const secret = randomBytes(32).toString('hex');
const text = `# PRIVATE: never commit or paste this file into an issue.\nAPI_KEYS=owner:${secret}\nPUBLIC_BASE_URL=${domain ? `https://${domain}` : 'http://localhost:8080'}\nNODE_ENV=${domain ? 'production' : 'development'}\nHOST=127.0.0.1\nPORT=8080\nDATA_DIR=./data\nVANTAGE_LABEL=self-hosted-single-node\nDOMAIN=${domain}\nALLOW_HTTP=false\nALLOWED_TARGET_HOSTS=\nDENIED_CIDRS=\nPROBE_TIMEOUT_MS=8000\nMAX_RESPONSE_BYTES=262144\nMAX_REDIRECTS=3\nMAX_CONCURRENT_PROBES=4\nMAX_CLIENT_CONCURRENCY=2\nREQUESTS_PER_MINUTE=120\nPROBES_PER_MINUTE=20\nEVIDENCE_TTL_SECONDS=86400\nMAX_EVIDENCE_RECORDS=2000\nMAX_CLIENT_EVIDENCE_RECORDS=200\n`;
try {
  await writeFile('.env', text, { flag: 'wx', mode: 0o600 });
  console.log('Created .env with a random service key (not printed). Keep it private.');
  console.log(domain ? 'Next: docker compose -f compose.prod.yaml up -d --build' : 'Next: pnpm test && pnpm start');
} catch (error) {
  console.error(error.code === 'EEXIST' ? '.env already exists; refusing to overwrite keys or configuration.' : error.message);
  process.exitCode = 1;
}
