import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseTarget, isPublicIp, validateAddresses, inCidr } from '../src/policy.mjs';
import { config } from './helpers.mjs';
const cfg = config();
for (const ip of ['0.0.0.0', '10.1.1.1', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '192.0.0.9', '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '168.63.129.16', '::', '::1', 'fc00::1', 'fe80::1', '::ffff:8.8.8.8', '::ffff:127.0.0.1', '64:ff9b::a00:1', '2001:db8::1', '2002:0808:0808::1', '3fff::1']) {
  test(`reject non-public/special address ${ip}`, () => assert.equal(isPublicIp(ip), false));
}
for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2001:4860:4860::8888', '2606:4700:4700::1111']) test(`allow normal global address ${ip}`, () => assert.equal(isPublicIp(ip), true));
for (const url of ['http://example.com', 'file:///etc/passwd', 'ftp://example.com/', 'https://user:secret@example.com', 'https://example.com/?token=secret', 'https://example.com/#hash', 'https://example.com:8443', 'https://localhost', 'https://service.local', 'https://localhost.example.internal', 'https://127.1', 'https://2130706433', 'https://0x7f000001', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://example.com.', 'https://exa mple.com', 'https://example.com\\@127.0.0.1']) test(`reject unsafe target ${url}`, () => assert.throws(() => parseTarget(url, cfg)));
test('allows HTTPS normal URL and Unicode domain normalization', () => { assert.equal(parseTarget('https://example.com/path', cfg).port, 443); assert.match(parseTarget('https://\u4f8b\u5b50.com', cfg).hostname, /^xn--/); });
test('HTTP requires explicit operator opt-in and default port', () => { assert.equal(parseTarget('http://example.com', { ...cfg, allowHttp: true }).port, 80); assert.throws(() => parseTarget('http://example.com:443', { ...cfg, allowHttp: true })); });
test('mixed public/private DNS is rejected as a whole', () => assert.throws(() => validateAddresses([{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }], cfg), { code: 'ADDRESS_BLOCKED' }));
test('address-family mismatch is rejected', () => assert.throws(() => validateAddresses([{ address: '8.8.8.8', family: 6 }], cfg)));
test('exact hostname allowlist does not allow attacker suffixes', () => { const c = { ...cfg, allowedHosts: ['example.com'] }; parseTarget('https://example.com', c); assert.throws(() => parseTarget('https://example.com.evil.org', c)); });
test('custom deny CIDRs apply to both families', () => { assert.equal(isPublicIp('8.8.8.8', ['8.8.8.0/24']), false); assert.equal(isPublicIp('2606:4700::1', ['2606:4700::/32']), false); assert.throws(() => inCidr('8.8.8.8', '8.8.8.0/99')); });
