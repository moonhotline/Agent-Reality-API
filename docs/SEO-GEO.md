# SEO, GEO and agent discovery

## Implemented

- Server-rendered, readable HTML for the homepage and five documentation pages; core information works without JavaScript.
- Unique titles and descriptions, canonical URLs built from configuration rather than the incoming Host, semantic headings and internal links.
- English and Chinese home entry points with `hreflang`. The Chinese landing entry is not a full translation of the English documentation.
- Open Graph and summary-card metadata; visible-content-aligned SoftwareApplication / TechArticle JSON-LD. No fabricated reviews, ratings, customer logos or usage statistics.
- `robots.txt` and `sitemap.xml`. Local development origins are disallowed. Protected evidence is authenticated and marked `noindex`; robots is not an access-control mechanism.
- OpenAPI, an MCP integration guide, concise `llms.txt`, full plain-text documentation generated from the same content source, and `/agent.json` explicitly marked as a project-specific manifest rather than a universal discovery standard.
- Specific, useful content about verdicts, body truncation, TLS, DNS pinning, JSON Pointer, ownership, expiration and verification boundaries.

## What these features do not promise

GEO is not a switch that guarantees agent adoption or AI search citations. An `llms.txt` file is a convenience index for clients that choose to use it. It does not replace search indexing, product differentiation or distribution. OpenAPI/MCP describe an interface; they do not cause arbitrary agents to discover and trust the service automatically.

Google's guidance states that established SEO fundamentals remain relevant to its generative AI experiences. Special AI text files or a special schema.org markup are not required. Follow the underlying principles rather than producing low-value pages for many keyword variations.

Primary references reviewed for this implementation:

- Google: https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- Google: https://developers.google.com/search/docs/appearance/ai-features
- MCP transports: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP tools: https://modelcontextprotocol.io/specification/2025-11-25/server/tools

## Launch actions that still require the real domain

Set `PUBLIC_BASE_URL`, point DNS correctly, obtain HTTPS, and inspect public HTML/canonicals. Verify domain ownership in the search-engine console and submit the sitemap. These actions are not performed by generating source code. An API must be actually reachable before it can be indexed or used.

Keep documentation public even if the source repository remains private. Add source and issue links after the repository exists; do not advertise an uncreated repository or a nonexistent hosted API as live. Submit to appropriate tool directories only after testing real client interoperability and meeting their authentication requirements.

## Measure value, not vanity

Track opted-in, aggregated repeat usage and real acceptance failures caught. Separate human site visits, crawler traffic and actual authenticated tool use. Do not log target URLs, request payloads or keys just to build analytics. No third-party tracking script is included.
