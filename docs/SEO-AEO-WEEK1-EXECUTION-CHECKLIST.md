# SEO + AEO Week 1 Execution Checklist

## Goal
Ship a production-safe SEO/AEO baseline for Festio public pages in 5 working days.

## Day 1: Crawl and index controls
- [ ] Add and verify `frontend/public/robots.txt` for production allow rules.
- [ ] Confirm staging/non-prod hosts are `noindex`/disallowed.
- [ ] Add sitemap generation task and expose `/sitemap.xml`.
- [ ] Validate with curl and browser on production-like environment.

Definition of done:
- `robots.txt` and `sitemap.xml` are reachable and correct for environment.

## Day 2: Public metadata and canonical
- [ ] Implement route-level `title` + `meta description` for public pages.
- [ ] Add canonical tags for landing/pricing/legal routes.
- [ ] Ensure canonical host is consistent (`festio.events`).

Definition of done:
- Public pages render unique metadata and correct canonical URLs.

## Day 3: AEO schema and answer blocks
- [ ] Add JSON-LD for `Organization` and `WebSite`.
- [ ] Add `SoftwareApplication` schema for Festio product page context.
- [ ] Publish FAQ section with 8 high-intent Q/A pairs.
- [ ] Add FAQPage schema for those pairs.

Definition of done:
- Rich Results validation passes for all schemas with no critical errors.

## Day 4: Crawler and preview validation
- [ ] Run no-JS/crawler validation for landing + pricing routes.
- [ ] Validate OG/Twitter cards for landing and invite links.
- [ ] Resolve any metadata/schema/preview mismatches.

Definition of done:
- Crawler snapshots show expected metadata and structured data.

## Day 5: Launch + measurement
- [ ] Submit sitemap to Search Console.
- [ ] Capture baseline metrics (impressions, clicks, CTR, indexed pages).
- [ ] Add AI referral/citation tracking notes and first query watchlist.
- [ ] Publish launch summary and owners for week-2 expansion.

Definition of done:
- Baseline report is published and signed off by Product + Marketing.

## Owners
- Frontend: metadata, schema, static/crawler output
- Backend: OG parity checks for invite/share links
- Platform/QA: validation scripts and release gates
- Marketing/Product: FAQ content, claims review, KPI ownership
