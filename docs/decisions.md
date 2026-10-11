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

**Decision:** Replace the dark single-page layout with a light, card-based layout with tabs (Overview, Reviews, Data health), a sticky filter bar, and charts drawn as inline SVG instead of a chart library.

**Why:** The previous page did not show this week vs last week, a property breakdown, positive and negative trends or insight sentences, and it injected review text into the page without escaping. Inline SVG avoids a CDN dependency and gives full control over accessibility (text summaries, tooltips, colour never the only signal).

## 2026-10-10: Rating scale is set per source, never guessed (bug fix)

**Problem (VERIFIED in the database):** `normalize.js` treated any score of 5 or below as a 1 to 5 score and doubled it. The primary actor's scores are already out of 10, so the 46 lowest-rated reviews were stored as 8s and 10s. Examples stored as 10/10: "Very dirty... cockroaches", "Double booked my booking". This hid the most negative reviews from every negative-review metric.

**Fix:** The scale now comes from the source: 10 for the primary actor, 5 for the fallback actor, `--scale` on imports (default 10). Regression test added.

**Data correction:** On 2026-10-10 the 46 affected rows (all with Booking `selected_review_id` links, so all from the primary actor) were halved back to their real scores and marked `exact`. Reversible with `rating_10 * 2` on the same rows if ever needed. Their AI tags were unaffected because the prompt does not include the rating.

## 2026-10-10: Warn staff about incomplete data on screen

**Decision:** The Data health tab checks each property for stale data (newest review older than 21 days) and a suspiciously narrow score band (50+ reviews, fewer than 4 distinct scores, none of them 10). The Overview shows a plain warning when the selected property is affected.

**Why:** Real data showed three properties with 100 reviews over years and only three adjacent scores. The dashboard computed perfectly reasonable-looking averages from them. Non-technical staff cannot spot that; the app has to say it.

**Trade-off:** A quiet property can trip the staleness check. The message says "either the property had none, or collection is not fetching new ones" rather than blaming collection.

## 2026-10-10: No LLM-based scraping fallback

**Considered:** Use the spare AI keys to read Booking.com pages directly when the Apify actor fails.

**Rejected because:** Fetching, not parsing, is the hard part. Booking.com blocks automated requests from cloud servers and loads reviews with JavaScript, which Vercel functions cannot run; an LLM does not solve either. A review page is 100 to 500 KB of HTML, tens of thousands of tokens, so it would exhaust key limits quickly. A model reading HTML can misread or invent scores and dates, which works against the reliability the task values most. It would also reverse the "no own scraping" decision and add terms-of-service risk.

**Instead:** Configure two Apify actors from different vendors as primary and fallback (`APIFY_ACTOR_ID`, comma-separated), keep the CSV and JSON importer as the manual fallback, and make AI key failover cover every failure type, not only rate limits.

## 2026-10-10: Three-actor fallback chain

**Decision:** Replace the original actor with `apt_marble` (primary), `omkar-cloud` (fallback) and `scrapeunblocker` (last resort), from three vendors.

**Evidence:** The original actor returned 100 reviews per property spread over two to three years with only three adjacent scores, while Booking.com lists 2,300 to 4,300 reviews per property and the counts keep rising. Prices and inputs come from Apify listings and are confirmed at run time, not assumed.

**How:** Input is mapped from each actor's published input schema (no guessed sort values); runs are incremental from the newest stored review minus 14 days; a property falls through to the next actor on start failure, failed run, empty output, stale output or a 1 to 5 looking scale; reviews are matched across actors by Booking's own id or by content.

**Trade-off:** More moving parts than one actor. In exchange, one vendor breaking or being blocked no longer stops collection, and a misbehaving actor is caught and skipped automatically.

## 2026-10-10: Re-collection never blanks stored fields (incident and fix)

**Incident:** The first `apt_marble` run matched all 75 Olympic Paddington reviews already stored (no duplicates), but the update path replaced whole rows. The actor did not supply replies, country, traveller type, room, stay date or review link, so 52 rows lost those fields. Ratings and text were unaffected.

**Fix:** Updates now merge: a field the source leaves empty never overwrites a stored value, and publication date and keys never change after insert. The lost values were restored from the committed sample export and verified by checksum against it (43 replies, 75 countries, rooms and links). Each run now records the field names the actor sent and which review fields it left empty, shown on the Data health tab.
