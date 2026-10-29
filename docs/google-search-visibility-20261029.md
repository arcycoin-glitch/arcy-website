# ARCY SEARCH — Google Search Console and AI search discoverability

Date prepared: 29 October 2026. Current canonical public site: https://www.arcyusdc.xyz/

## Technical changes made in this PR

- `/robots.txt` allows crawling and points to `https://www.arcyusdc.xyz/sitemap.xml`.
- `/sitemap.xml` lists only the canonical homepage and the separate Transparency & Verification page. Do **not** add `/#search`, the redirected `/search` path, API routes or guessed token addresses.
- Homepage now has a canonical link, discoverable description, social previews and a grounded `WebSite` JSON-LD name: ARCY SEARCH.
- Transparency canonical is preserved; its metadata reflects the **upcoming token** instead of advertising the previous Arc token contract as new. Its `WebPage` JSON-LD is part of the same site.
- The existing visual page sections, old-token retirement, Search 20 checks, Pulse, Unlocks and Market Radar's licensing gate remain untouched.

## Google Search Console: requires the website owner's account

1. Sign into https://search.google.com/search-console/ with the Google account that should own the domain.
2. Add a **Domain property** `arcyusdc.xyz`; verify ownership with the TXT DNS record **Google generates for that specific account**. Do not invent, publicly share or reuse an unrelated verification token. If domain DNS is unavailable, use a URL-prefix property `https://www.arcyusdc.xyz/` and an ownership proof supplied by Google.
3. Once verified, submit the existing sitemap URL in Search Console > Sitemaps: `https://www.arcyusdc.xyz/sitemap.xml`.
4. Use **URL Inspection** for `https://www.arcyusdc.xyz/` and `https://www.arcyusdc.xyz/transparency.html`; request indexing only when the published pages are accessible and eligible.
5. Review Pages > Indexing, Sitemaps processing, Web search performance and any security/manual actions. Inspect genuinely indexed URLs rather than guessing search results.
6. Recheck after Google's own crawling cycle. Submission, schema and an open robots file are hints, not guarantees of indexing, rankings or mentions by any particular AI product.

## Accuracy and quality

Write occasional **source-linked, substantial, original, accessible HTML research pages** rather than only dynamic or image-only announcements. Prefer per-project method, exact contract + chain, evidence link, date, and *unverified* fields clearly marked. Avoid fabricated audits, token claims, fake reviews, generated backlinks or statements that Google/ChatGPT endorses ARCY. An unverified Token Unlocks record must never be described as a confirmed project unlock.

Google guidance:
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- https://developers.google.com/search/docs/appearance/site-names
- https://developers.google.com/search/docs/appearance/ai-features

## Operational boundary

Code changes are deployed automatically through GitHub/Vercel after merging, but **Search Console account verification and sitemap submission cannot be completed solely by publishing website source files**. They require owner-side Google authorization or an appropriate connected service.
