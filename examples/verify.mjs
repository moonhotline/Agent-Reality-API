const base = process.env.REALITY_BASE_URL || 'http://localhost:8080';
const key = process.env.REALITY_API_KEY;
const target = process.argv[2];
if (!key || !target) throw new Error('Usage: REALITY_API_KEY=... node examples/verify.mjs https://your-site.com/version');
const response = await fetch(new URL('/v1/verify/website', base), {
  method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  body: JSON.stringify({ url: target, assert: { status: 200 }, detail: 'compact' }), signal: AbortSignal.timeout(15000)
});
const result = await response.json();
console.log(JSON.stringify(result, null, 2));
if (!response.ok || result.verdict !== 'pass') process.exitCode = 1;
