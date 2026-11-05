import { test } from 'vitest';
import assert from 'node:assert/strict';
import https from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

for (const runtime of ['node', 'bun']) {
  test(`${runtime}: real TLS rejects untrusted certificates, accepts a test CA and rejects the wrong hostname`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'reality-tls-'));
    t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
    const key = join(dir, 'key.pem'); const cert = join(dir, 'cert.pem');
    await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=reality-fixture.example', '-addext', 'subjectAltName=DNS:reality-fixture.example']);
    const server = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, (_req, res) => res.end('fixture'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.onTestFinished(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const url = `https://reality-fixture.example:${server.address().port}`;
    const binary = runtime === 'node' ? process.execPath : (process.env.BUN_BIN || 'bun');
    const args = runtime === 'node' ? ['--input-type=module', '-e'] : ['-e'];
    const code = `import {fetchPinned} from ${JSON.stringify(new URL('../src/probe.mjs', import.meta.url).href)};
      try {const r=await fetchPinned({url:new URL(${JSON.stringify(url)})},{address:'127.0.0.1',family:4},{signal:AbortSignal.timeout(2000),maxBodyBytes:1024});
      console.log(JSON.stringify({body:r.body.toString(),tls:r.tls}));} catch(e){console.error(e.code,e.message);process.exitCode=1;}`;
    const cleanEnv = { ...process.env }; delete cleanEnv.NODE_EXTRA_CA_CERTS;
    await assert.rejects(exec(binary, [...args, code], { env: cleanEnv, timeout: 5000 }), error => /CERT|SELF_SIGNED|certificate/i.test(error.stderr));
    const options = { env: { ...cleanEnv, NODE_EXTRA_CA_CERTS: cert }, timeout: 5000 };
    const child = await exec(binary, [...args, code], options);
    const result = JSON.parse(child.stdout);
    assert.equal(result.body, 'fixture');
    assert.equal(result.tls.authorized, true);
    assert.ok(result.tls.fingerprint_sha256);
    const mismatch = code.replace('reality-fixture.example:', 'wrong-host.example:');
    await assert.rejects(exec(binary, [...args, mismatch], options), error => /ALTNAME|hostname|Host name|does not match/i.test(error.stderr));
  });
}
