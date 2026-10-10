# Decisions

## 2026-10-10: P0 actor selection

**Decision:** Use the first configured Apify actor, Booking.com Reviews 1.5/1k, as the primary collector. Keep Booking Reviews Scraper as the fallback.

**Evidence:** A bounded probe of Olympic Hotel Paddington returned exactly five review rows for the primary actor at an observed run cost of about USD 0.013. It provides exact scores on Booking.com's 10-point scale, review date, positive and negative text, country, traveller type, room type, stay dates, reply text and review URL. Its raw response includes a reviewer field, which is deliberately discarded by the privacy allowlist.

The fallback returned a usable nested response with 75 reviews even though its input requested five. Its scores are on a 1 to 5 scale and must be stored as rounded 10-point equivalents. It also includes reviewer names in raw output. These do not disqualify it as a fallback, but make it less predictable for incremental collection and cost control.

**Trade-off:** The primary actor did not expose a dedicated review-id field in its review objects. The implementation will use the existing deterministic content hash dedupe path, with the selected review ID parsed from the review URL only when present.

**Status:** VERIFIED by two real P0 probe runs. Actor behaviour can change and will be rechecked by drift detection.

## 2026-10-10: Dashboard aggregation in JavaScript

**Decision:** Compute all dashboard metrics in `lib/analytics.js` from a list of reviews, instead of SQL functions.

**Why:** One tested module serves both the live database and the committed sample file, so a fresh clone runs the full dashboard with no database. Weeks are computed explicitly in `Australia/Sydney` with daylight saving handled (`lib/weeks.js`), never in the server's time zone.

**Trade-off:** Each request loads the reviews for the needed range. Fine at hundreds of reviews a year; would need SQL aggregation at much larger volumes. Reads are paged so the PostgREST 1,000-row cap can never silently truncate totals.

## 2026-10-10: Cron polling instead of an Apify webhook

**Decision:** The daily cron first ingests runs started the previous day, then starts new ones. No `/api/ingest` webhook.

**Why:** No public URL or webhook secret to manage, works the same locally, and stuck or missed runs are recovered automatically because every `running` row is re-checked.

**Trade-off:** Up to one day of extra lag before new reviews appear.

## 2026-10-10: Ratings, not AI sentiment, define positive and negative

**Decision:** Positive and negative bands use the guest's own score (8+ and below 6). The AI sentiment score is stored but not displayed.

**Why:** Staff can verify a rating against Booking.com; a model score is harder to explain and adds a second, possibly conflicting, definition of "negative".

## 2026-10-10: Dashboard redesign

**Decision:** Replace the dark single-page layout with a light, card-based layout with tabs (Overview, Reviews, Data health), a sticky filter bar, dark mode from the operating system setting, and charts drawn as inline SVG instead of a chart library.

**Why:** The previous page did not show this week vs last week, a property breakdown, positive and negative trends or insight sentences, and it injected review text into the page without escaping. Inline SVG avoids a CDN dependency and gives full control over accessibility (text summaries, tooltips, colour never the only signal).

## 2026-10-10: Rating scale is set per source, never guessed (bug fix)

**Problem (VERIFIED in the database):** `normalize.js` treated any score of 5 or below as a 1 to 5 score and doubled it. The primary actor's scores are already out of 10, so the 46 lowest-rated reviews were stored as 8s and 10s. Examples stored as 10/10: "Very dirty... cockroaches", "Double booked my booking". This hid the most negative reviews from every negative-review metric.

**Fix:** The scale now comes from the source: 10 for the primary actor, 5 for the fallback actor, `--scale` on imports (default 10). Regression test added.

**Data correction:** On 2026-10-10 the 46 affected rows (all with Booking `selected_review_id` links, so all from the primary actor) were halved back to their real scores and marked `exact`. Reversible with `rating_10 * 2` on the same rows if ever needed. Their AI tags were unaffected because the prompt does not include the rating.
