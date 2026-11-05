# Verification report - 0.2.0

Date: 2026-11-05. This is an implementation and regression report, not an independent security audit or a claim of public service availability.

## Executed in the delivery environment

Toolchain: pnpm **11.21.0**, Bun **1.4.4**, Node.js **22.16.0**, Vitest **5.1.0**, official MCP SDK **1.32.2**, Linux x86_64. Dependency versions and the lockfile were resolved by GitHub Actions, then the resulting toolchain was used locally.

`pnpm test` passed **114 tests in 5 files**, with no failures or skipped tests. All prior 110 regressions were retained and migrated from node:test to Vitest. The actual Vitest runner executes on Node; the production runtime tests launch actual Bun subprocesses, not bun:test aliases or mocks pretending to be Bun.

| Boundary | Evidence |
|---|---|
| URL/address policy | Private, special-use, metadata, mapped/transition IPs and unsafe URL forms rejected |
| DNS and redirects | Mixed unsafe answers, rebinding-shaped fixtures, unsafe redirects and downgrade cases covered |
| Real HTTP transport | Both runtimes connect to a pinned local fixture while preserving the original Host; response bytes are bounded |
| Real TLS transport | Node and Bun reject an untrusted certificate, accept an isolated test CA, and reject a mismatched hostname |
| Assertion semantics | Status, source text, JSON Pointer, truncation and unreadable-body verdicts covered |
| Persistence | Restart recovery, ownership isolation, expiry, quotas and integrity checked |
| Actual Bun service | Starts src/main.mjs, serves HTTP/docs/OpenAPI, enforces authentication and rejects forbidden targets |
| Official MCP SDK | Client initializes, discovers tools and exercises a blocked-target tool call against the real Bun service |
| Toolchain contracts | pnpm lockfile, Bun start command, Vitest test command and shared REST/MCP input schema checked |

Raw local test output is retained in `docs/verification/vitest.txt` and `docs/verification/checks.txt`. Test TLS keys are temporary and removed; no production TLS bypass is introduced.

## Repository and CI

The connected tools support existing-repository writes but do not expose repository creation. The personal fallback target is `moonhotline/test_repo`, whose original main branch contained only a placeholder README. Work is isolated on `feat/agent-reality-api-pnpm-bun-vitest` until the final integration step.

The committed CI workflow installs the frozen pnpm lockfile, runs the checks and all Vitest regressions, validates both Compose files, builds the Bun Docker image, and runs HTTP and official SDK checks against that container. Consult the actual GitHub Actions run for the submitted commit; a workflow file alone is not evidence of success.

## Not established by these tests

Public VPS deployment, Caddy certificate issuance, the user's real DNS/domain, production-volume permissions on their host, full browser navigation, every third-party agent client, OAuth-only clients, load capacity on a 1 GiB VPS, independent penetration testing, search indexing/ranking and AI citations remain separate acceptance tasks.

No external public target is contacted by the default regression suite. Real network tests use controlled local fixtures; policy seams are not exposed as production settings. The previous static visual inspection concerned the same page layout before this toolchain migration; it is not reclassified as live browser end-to-end verification.
