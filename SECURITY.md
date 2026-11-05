# Security policy and threat model

## Scope

This project performs bounded outbound GET requests against authenticated users' public targets. It does not execute supplied code, render pages, forward target credentials or provide unrestricted network access. It is an MVP, not an audited security boundary or DDoS protection service.

## Controls

- No anonymous probes. Random per-client keys are hashed for constant-time comparison in the process. The operator still holds the original secrets in private configuration.
- Strict request size, shape, time and concurrency limits; in-memory rate windows keyed by authenticated client identity.
- HTTPS by default; explicit HTTP opt-in; default ports only. No userinfo, query strings, fragments or local hostnames.
- Conservative special-use IP screening including common metadata addresses, all DNS answers, IPv4-mapped IPv6 and transition ranges. Exact hostname allowlist and operator-defined CIDR denies are available.
- Pin the screened address in the real network lookup; re-check every redirect; prohibit HTTPS downgrade. Normal TLS CA and hostname verification stay enabled.
- No request credentials, cookies or arbitrary headers forwarded to targets. No raw bodies persisted or returned. Selected metadata and asserted values are still untrusted data.
- Host and Origin validation; no wildcard CORS. Security headers and a restrictive CSP on public pages.
- Private, owner-scoped evidence with expiry, quotas, atomic writes and consistency checking. Record digests are not signatures.
- Non-root runtime, read-only container filesystem, persistent bounded data, dropped capabilities and bounded container logs.

## Residual risks and operator responsibilities

The application cannot defend against a large volumetric attack, all future DNS/IP allocation changes, provider-specific routing, an untrusted host operator, compromised TLS trust roots or all possible runtime vulnerabilities. Apply egress firewall controls independently, patch Bun/Node/Caddy/base images and prefer a strict target allowlist for small trusted deployments.

Do not submit customer data, credentials or secrets. Target paths, expected strings, returned scalar values and metadata may be sensitive even without query strings. Backups need private access and an independent retention policy. Logs avoid payloads, but hosting infrastructure may log requests separately; inspect its configuration.

Use only targets you are authorized to test. GET is intended to be safe, but a third-party service may implement side effects incorrectly. Do not market a passing network check as proof of security, compliance, UI correctness or global uptime.

Rate limits reset with the process. File persistence supports one writer only. There is no anonymous free tier, OAuth discovery, administrative web UI, multi-tenant billing or signed attestation service.

## Reporting issues

Do not put live exploit URLs, service keys, private evidence or customer data into public issues. After the GitHub repository is created, the maintainer should enable GitHub private vulnerability reporting and publish a verified private contact. Until that is available, share only a non-sensitive request for a private reporting channel.

## Security regression requirements

Changes to DNS, URL parsing, redirects, TLS, transport, auth or storage must include tests. Never add `rejectUnauthorized: false`, a request-controlled proxy, private-network bypass, arbitrary port option, credentials forwarding or a test escape hatch to production configuration. Treat remote content as data rather than instructions to an agent.
