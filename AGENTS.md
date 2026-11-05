# Repository guide for coding agents

Product: bounded external website verification with private, expiring evidence. The first release is not a general agent toolkit.

## Commands

- `pnpm check`: JavaScript syntax, shared REST/MCP schema and required files.
- `pnpm test`: Vitest regression suite plus real Node/Bun HTTP/TLS fixtures; needs Bun and OpenSSL.
- `pnpm env:init`: creates private .env once; never overwrites.
- `pnpm start`: local server; `pnpm smoke`: service/protocol checks against a running server.

## Invariants

Keep a single source of input schema in src/schema.mjs. REST and MCP call the same service. Inconclusive must not become pass. HTTP 200 is not a business-success assertion. Raw source matching is not browser rendering. Preserve all limits, ownership checks and SSRF defenses. Tests must never query real metadata endpoints. Keep fixture injection in code/tests, not exposed as an API or environment bypass.

Do not forward auth/cookies, accept arbitrary ports, disable TLS validation, store raw response bodies, trust forwarded IP headers for key quotas, or share the data directory across instances. Do not commit .env, keys, node_modules, data or private logs.

## Scope and verification

Keep dependencies proportionate. pnpm manages dependencies; Bun runs production; Vitest runs under Node and launches Bun subprocesses. Use pnpm-lock.yaml only. Runtime code uses compatible node:* built-ins with no runtime packages. Add tests with every behavior change. Run pnpm install --frozen-lockfile, pnpm check and pnpm test; update README and generated public docs together when contracts change. Distinguish checks actually run from CI files merely written. Record limitations honestly. GitHub Actions, live DNS/TLS deployment and external SDK compatibility are not proven by passing mock tests.

Read docs/ARCHITECTURE.md and SECURITY.md before touching network or storage boundaries. Read docs/DEPLOYMENT.md before deployment. Do not create infrastructure, buy a domain, change unrelated services or publish private data without authorization.
