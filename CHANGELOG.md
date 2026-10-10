# Changelog

## Unreleased

### Added
- AI tagging clears any backlog on its own: after the cron's batch, each call tags for up to 4.5 minutes (function limit raised to 300 s) and hands on to `/api/enrich` up to three times, waiting out rate limits. No laptop step after a large collection.

## 0.2.0, 2026-10-10

### Added
- Dashboard rebuilt: Overview, Reviews and Data health tabs; this week vs last week; property table with sparklines; weekly positive and negative trends; complaint topics with change; plain-language insight sentences; needs-attention flags; light and dark mode; phone layout.
- Sydney-time week maths with daylight saving tests.
- Daily cron endpoint `/api/collect` (fail-closed secret), which ingests, collects and AI-tags.
- Data checks: stale data and suspicious score bands per property, shown to staff.
- AI evidence check, keyword baseline, precision and recall tooling, labelling template.
- Real sample data (375 reviews), seed from sample, secret scanner, runbook and known-unknowns docs.

### Fixed
- Low 10-point scores were doubled as if they were 5-point scores; 46 stored reviews corrected.
- Review text was inserted into the page without escaping.
- Weeks were bucketed in UTC instead of Sydney time.
- Database reads could silently stop at 1,000 rows.
- Failed, empty or unreachable Apify runs were left "running" or lost.
- AI rate limits used up a review's retry attempts.

## 0.1.0, 2026-10-10
- Collection spike, ingest pipeline, AI enrichment and first dashboard.
