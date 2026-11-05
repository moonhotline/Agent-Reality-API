# Architecture and bounded commitments

## Product outcome

A coding agent can verify an authorized public endpoint against explicit criteria, receive an honest compact result, and retrieve a private observation record after a process restart. This is the initial milestone; more tools are not the success criterion.

## Design choices

A single Bun process uses compatible node:* standard-library modules for HTTP, DNS, TLS, JSON, hashing and atomic file writes. Zero runtime npm dependencies avoids runtime install/build overhead on a small VPS. Source is ECMAScript modules, with JSON Schema at external boundaries and Vitest regression tests with real Bun subprocess coverage. This is intentionally not a TypeScript/Next.js monorepo or a hosted LLM app.

The transport, URL policy, assertion logic, persistence and API layers are separated. Tests inject DNS and transport only through constructor dependencies, never via request parameters or production environment bypasses.

REST and MCP call the same VerificationService and share one input schema. Authentication and request quotas apply before executing either interface. Probe concurrency is bounded globally and per authenticated client; excess work is rejected, not put into an unbounded queue.

## Evidence persistence

One file per UUID record, mode 0600, within an operator-controlled 0700 directory. A write uses a unique temporary file, file fsync, atomic rename and directory fsync on non-Windows platforms. Writes are serialized. The startup scan validates record digests and fails visibly on corruption rather than silently discarding evidence. Expired records are removed. A full quota returns a capacity error without evicting unexpired records.

The envelope stores a client ID for authorization; the returned record does not expose the service key. Record hashes are consistency checks, not signatures. This is neither a distributed database nor an immutable forensic ledger. Disk failure, operator modification and deleted volumes remain outside the guarantee.

## Request lifecycle

Authenticate -> rate-limit -> strict input validation -> URL policy -> acquire bounded slot -> resolve and screen all returned addresses -> pin selected address -> authenticate TLS and read bounded HTTP response -> revalidate each redirect -> evaluate assertions -> persist evidence -> return chosen output level -> release slot.

Input-policy rejections return an HTTP error without opening a socket. An observation blocked during DNS or redirection yields an inconclusive record. Target HTTP errors and assertion mismatches are verification results, not API infrastructure errors.

## Intentional omissions

No durable background queue, retry scheduler, web browser, LLM summarizer, generalized proxy, webhook inbox, anonymous key issuance, OAuth server, account database, payment integration, multi-region probes, metrics product or autonomous deployment. Introduce these only with a concrete beneficiary, observable acceptance test and maintenance budget.

## Next acceptance milestone

Use the verifier on owned, real deployment workflows with an exact release assertion. Observe whether developers use it again and whether it finds a failure their existing workflow missed. Do not describe the project as validated by market demand before collecting that evidence.
