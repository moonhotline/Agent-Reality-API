# Changelog

## 0.2.0 - 2026-11-05

- Pin pnpm 11.21.0 and a single pnpm lockfile; remove npm lockfile.
- Run the service and production Docker/systemd entrypoints on Bun 1.4.4.
- Replace node:test with Vitest 5.1.0; retain all 110 prior regressions.
- Add actual Bun-process HTTP/MCP, official SDK and transport checks; test TLS trust/hostname checks on both runtimes (114 total).
- Pin the official MCP SDK as a development-only dependency.
- Update public docs, README, CI and deployment instructions together.
- Use personal fallback repository moonhotline/test_repo; do not modify unrelated projects.


## 0.1.0 - 2026-11-05

Initial source release: bounded public HTTPS verification; status, raw UTF-8 source and JSON Pointer assertions; private expiring records; compact/standard/full outputs; authenticated REST and a limited stateless MCP transport; server-rendered landing and documentation pages; VPS deployment assets; regression and smoke tests.

Not included: hosted production service, OAuth discovery, headless browser, multi-region monitoring, billing, event inboxes, shared agent memory or signed attestations. Repository publication and deployment status are described separately in the delivery verification report.
