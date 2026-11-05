import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import http from 'node:http';
import { KEY_A } from './helpers.mjs';

const exec = promisify(execFile);
const bun = process.env.BUN_BIN || 'bun';
const project = fileURLToPath(new URL('../', import.meta.url));

async function startBun(t) {
  const dir = await mkdtemp(join(tmpdir(), 'reality-bun-'));
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(bun, [join(project, 'src/main.mjs')], {
    cwd: dir,
    env: { ...process.env, API_KEYS: `runtime:${KEY_A}`, NODE_ENV: 'test', PUBLIC_BASE_URL: base,
      HOST: '127.0.0.1', PORT: String(port), DATA_DIR: join(dir, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.onTestFinished(async () => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit');
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 3000);
      await exit;
      clearTimeout(force);
    }
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Bun startup timed out: ${output}`)), 8000);
    const done = (error) => { clearTimeout(timer); error ? reject(error) : resolve(); };
    child.on('error', done);
    child.on('exit', code => done(new Error(`Bun exited ${code}: ${output}`)));
    child.stdout.on('data', () => { if (output.includes('"event":"listening"')) done(); });
  });
  return { base, child };
}

test('production Bun process passes HTTP, discovery, authentication and MCP protocol checks', async t => {
  const { base } = await startBun(t);
  assert.equal((await (await fetch(`${base}/healthz`)).json()).runtime, 'bun');
  const result = await exec(process.execPath, [join(project, 'scripts/smoke.mjs')], {
    env: { ...process.env, REALITY_BASE_URL: base, REALITY_API_KEY: KEY_A }, timeout: 10000,
  });
  assert.match(result.stdout, /smoke checks passed/);
  const denied = await fetch(`${base}/v1/verify/website`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error.code, 'UNAUTHORIZED');
});

test('official MCP SDK interoperates with the production Bun process', async t => {
  const { base } = await startBun(t);
  const result = await exec(process.execPath, [join(project, 'scripts/sdk-smoke.mjs')], {
    env: { ...process.env, REALITY_BASE_URL: base, REALITY_API_KEY: KEY_A }, timeout: 10000,
  });
  assert.match(result.stdout, /Official SDK initialize/);
});

test('Bun transport connects only to the pinned address, preserves Host and bounds response bytes', async t => {
  let observed;
  const server = http.createServer((request, response) => { observed = request.headers; response.end('x'.repeat(5000)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.onTestFinished(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const target = `http://no-dns-needed.example:${server.address().port}`;
  // Explicit transport fixture only; never permit private targets in the production API.
  const code = `import {fetchPinned} from ${JSON.stringify(new URL('../src/probe.mjs', import.meta.url).href)};
    const r=await fetchPinned({url:new URL(${JSON.stringify(target)})},{address:'127.0.0.1',family:4},{signal:AbortSignal.timeout(2000),maxBodyBytes:1024});
    console.log(JSON.stringify({bytes:r.body.length,complete:r.complete,remote:r.remote_address}));`;
  const child = await exec(bun, ['-e', code], { timeout: 5000 });
  const result = JSON.parse(child.stdout);
  assert.equal(result.bytes, 1024);
  assert.equal(result.complete, false);
  assert.equal(observed.host, new URL(target).host);
  assert.equal(observed.authorization, undefined);
  assert.equal(observed.cookie, undefined);
});
