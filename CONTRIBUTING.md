# Contributing

Begin with the smallest user-visible behavior change and an acceptance test. Keep network policy, transport, assertion evaluation and persistence separate. Use Vitest for behavior-focused regression tests, including actual Bun subprocesses; production requests must never acquire a test-only bypass.

Run `pnpm check` and `pnpm test`. For client-facing protocol changes, run the official SDK compatibility script and a target agent client when network access is available. For deployment changes, validate Compose, build the image and validate Caddy rather than only reviewing YAML.

Explain which tests were executed and which were not. Do not publish credentials, target payloads or personal records in issues or fixtures. Review SECURITY.md before reporting vulnerabilities.

Documentation should explain limitations with the same precision as features. Do not add unverified performance numbers, fake testimonials, invisible SEO text or claims of universal MCP compatibility.
