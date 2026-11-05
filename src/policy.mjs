import { isIP } from 'node:net';
import { Resolver } from 'node:dns/promises';
import { AppError } from './errors.mjs';

// Conservative allow-by-exclusion for IPv4 and allow-by-prefix for IPv6.
// IPv4-mapped IPv6 and transition mechanisms are intentionally rejected.
const BLOCKED_V4 = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4', '168.63.129.16/32'];
const BLOCKED_V6 = ['2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20'];
function ipNumber(input) {
  const family = isIP(input);
  if (family === 4) return { family, bits: 32, value: input.split('.').reduce((n, part) => (n << 8n) | BigInt(part), 0n) };
  if (family !== 6) throw new Error('Invalid IP address');
  let ip = input;
  if (ip.includes('.')) {
    const cut = ip.lastIndexOf(':');
    const v4 = ipNumber(ip.slice(cut + 1)).value;
    ip = `${ip.slice(0, cut)}:${(v4 >> 16n).toString(16)}:${(v4 & 65535n).toString(16)}`;
  }
  const pieces = ip.split('::');
  const left = pieces[0] ? pieces[0].split(':') : [];
  const right = pieces[1] ? pieces[1].split(':') : [];
  const words = pieces.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return { family, bits: 128, value: words.reduce((n, word) => (n << 16n) | BigInt(`0x${word}`), 0n) };
}
export function inCidr(ip, cidr) {
  const [address, prefix, extra] = cidr.split('/');
  const network = ipNumber(address);
  if (extra || prefix === undefined || !/^\d+$/.test(prefix) || Number(prefix) > network.bits) throw new Error(`Invalid CIDR: ${cidr}`);
  const candidate = ipNumber(ip);
  if (candidate.family !== network.family) return false;
  const shift = BigInt(network.bits - Number(prefix));
  return candidate.value >> shift === network.value >> shift;
}
export function isPublicIp(ip, deniedCidrs = []) {
  const family = isIP(ip);
  if (!family || ip.includes('%')) return false;
  if (deniedCidrs.some(cidr => inCidr(ip, cidr))) return false;
  if (family === 4) return !BLOCKED_V4.some(cidr => inCidr(ip, cidr));
  return inCidr(ip, '2000::/3') && !BLOCKED_V6.some(cidr => inCidr(ip, cidr));
}
export function parseTarget(raw, config) {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(raw)) throw new AppError('INVALID_URL', 'Supply an absolute URL without spaces, controls or backslashes.');
  let url;
  try { url = new URL(raw); } catch { throw new AppError('INVALID_URL', 'Supply a valid absolute URL.'); }
  if (url.protocol !== 'https:' && !(config.allowHttp && url.protocol === 'http:')) throw new AppError('SCHEME_BLOCKED', 'HTTPS is required; HTTP is an explicit operator opt-in.');
  if (url.username || url.password || url.search || url.hash) throw new AppError('URL_SECRETS_NOT_ALLOWED', 'Credentials, query strings and fragments are not accepted. Use a public, non-sensitive verification endpoint.');
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (port !== (url.protocol === 'https:' ? 443 : 80)) throw new AppError('PORT_BLOCKED', 'Only the default port for HTTP or HTTPS is permitted.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname.endsWith('.') || /(^|\.)(localhost|local|internal|lan|home|invalid)$/.test(hostname) || (!hostname.includes('.') && !isIP(hostname))) throw new AppError('HOST_BLOCKED', 'This hostname is not an allowed public target.');
  if (config.allowedHosts.length && !config.allowedHosts.includes(hostname)) throw new AppError('HOST_NOT_ALLOWLISTED', 'The target is outside the operator allowlist.');
  if (isIP(hostname) && !isPublicIp(hostname, config.deniedCidrs)) throw new AppError('ADDRESS_BLOCKED', 'Non-public, special-use or operator-denied addresses are forbidden.');
  return { url, hostname, port };
}
export async function resolvePublic(hostname, config, signal) {
  signal?.throwIfAborted();
  if (isIP(hostname)) return [{ address: hostname, family: isIP(hostname) }];
  const resolver = new Resolver({ timeout: Math.min(config.timeoutMs, 2000), tries: 1 });
  const cancel = () => resolver.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const results = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
    signal?.throwIfAborted();
    const addresses = results.flatMap((r, i) => r.status === 'fulfilled' ? r.value.map(address => ({ address, family: i === 0 ? 4 : 6 })) : []);
    if (!addresses.length) throw new AppError('DNS_LOOKUP_FAILED', 'No usable DNS address was returned from this vantage point.', 422, true);
    return validateAddresses(addresses, config);
  } finally { signal?.removeEventListener('abort', cancel); }
}
export function validateAddresses(addresses, config) {
  if (!Array.isArray(addresses) || !addresses.length || addresses.length > 64 || addresses.some(a => isIP(a.address) !== a.family || !isPublicIp(a.address, config.deniedCidrs))) {
    throw new AppError('ADDRESS_BLOCKED', 'DNS returned a prohibited address or an unsafe answer set.');
  }
  return addresses;
}
