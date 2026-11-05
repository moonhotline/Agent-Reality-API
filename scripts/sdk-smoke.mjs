// Optional interoperability check. SDK is a test-only dependency, not a runtime dependency.
// Run: pnpm install --frozen-lockfile; pnpm test:sdk
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const key = process.env.REALITY_API_KEY;
if (!key) throw new Error('Set REALITY_API_KEY.');
const base = process.env.REALITY_BASE_URL || 'http://localhost:8080';
const client = new Client({ name: 'reality-sdk-smoke', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL('/mcp', base), { requestInit: { headers: { authorization: `Bearer ${key}` } } });
try {
  await client.connect(transport);
  const listed = await client.listTools(); assert.equal(listed.tools.length, 2);
  const blocked = await client.callTool({ name: 'verify_website', arguments: { url: 'https://127.0.0.1' } }); assert.equal(blocked.isError, true);
  console.log('Official SDK initialize, tools/list and error-path tools/call passed.');
} finally { await client.close(); }
