import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { openapi } from '../src/openapi.mjs';
import { verifySchema } from '../src/schema.mjs';
import { tools } from '../src/mcp.mjs';
async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}
assert.ok(!process.versions.bun, 'Run the syntax checker with Node.js. Production runs Bun.');
const files = (await Promise.all(['src', 'scripts', 'test', 'public', 'examples'].map(walk))).flat().filter(f => /\.(mjs|js)$/.test(f));
for (const path of files) execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
const api = openapi({ baseUrl: 'https://api.example.com' });
assert.deepEqual(api.components.schemas.VerifyRequest, tools[0].inputSchema);
assert.deepEqual(verifySchema, tools[0].inputSchema);
for (const name of ['README.md', 'SECURITY.md', 'AGENTS.md', 'docs/DEPLOYMENT.md', 'docs/SEO-GEO.md', 'docs/VERIFICATION.md', '.github/workflows/ci.yml', 'pnpm-lock.yaml', 'vitest.config.mjs']) assert.ok((await readFile(name)).length > 50, `${name} missing or empty`);
console.log(`Syntax checked ${files.length} JavaScript modules; REST/MCP input contracts agree; required documentation exists.`);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(pkg.packageManager, 'pnpm@11.21.0');
assert.equal(pkg.scripts.test, 'vitest run');
assert.ok(pkg.scripts.start.startsWith('bun '));
assert.equal(pkg.devDependencies.vitest, '5.1.0');
assert.equal((await readFile('.bun-version', 'utf8')).trim(), '1.4.4');
for (const path of files.filter(path => path.startsWith('test/'))) {
  assert.ok(!(await readFile(path, 'utf8')).includes("from 'node:test'"), `${path}: use Vitest`);
}
console.log('pnpm lockfile, Bun runtime and Vitest test contracts verified.');
