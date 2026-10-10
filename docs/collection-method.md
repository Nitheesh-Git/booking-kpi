# Collection method

Status labels: VERIFIED (checked against real data or tests), ASSUMED, UNKNOWN, UNTESTED.

## Why a third-party actor

Booking.com gives us no API access (task brief), and headless browsers cannot run on Vercel. Collection therefore uses a hosted Apify actor that reads the public review pages. Our code only starts runs, reads their datasets and cleans the rows.

Booking.com does run an official Guest Review API for connectivity partners. If Azzurro can get access through its channel manager, it would replace scraping entirely. See ROADMAP.md.

## Sources

Three Apify actors from different vendors, tried in order (`APIFY_ACTOR_ID`). Prices are listing figures, 2026-10-10:

| Order | Actor | Price per 1,000 | Why |
|---|---|---|---|
| 1 | `apt_marble/booking-reviews-scraper` | from USD 0.30 | Newest-first sort and a "since" date that stops the run early. New, unrated |
| 2 | `omkar-cloud/booking-reviews-scraper` | USD 1.00 | Established publisher, newest sort and a cutoff date |
| 3 | `scrapeunblocker/booking-reviews-scraper` | USD 0.40 | Last resort: only the newest 15 reviews per language, fine for daily top-ups, not for backfill |

At about 2,500 to 3,000 reviews for a 12-month backfill and a few hundred a month after that, cost is a few dollars at most; reliability decided the order.

**How input is built (`lib/actors.js`).** The actors' input names come from their listings and are UNTESTED here, so before each run the collector downloads the actor's published input schema from Apify and maps four things by field name and allowed values: hotel URL, review cap, newest-first sort and since-date. It never guesses a sort value that is not in the schema's list. If the schema cannot be read, a built-in profile per actor is used. `APIFY_INPUT_OVERRIDES` can force any field, for all actors or per actor.

**Actor fallback.** A property moves to the next actor when the current one will not start, its run fails, returns no rated rows, returns only reviews older than 21 days, or returns scores that look like a 1 to 5 scale. Each run row records its actor and property, so the right scale is applied and the Data health tab shows which actor ran.

The previous actor (Booking.com Reviews, used for the first collection) was dropped: see "New reviews" below.

## What is kept

`lib/normalize.js` is the only place source rows become reviews, and it uses an allowlist: rating, title, liked text, disliked text, publication date, stay date, country, traveller type, room, nights, property reply, review link. Reviewer names and any other identifiers are never stored, logged, exported or shown. Text stays in its original language.

The rating scale is set by the source, never guessed from the number (see "Incidents" below).

## Duplicates

Each review gets a `dedupe_key`: Booking's own review id from the review link when present (it wins over any actor-specific id, so different actors agree), otherwise the actor's review id, otherwise a hash of property, publication date and text.

Two more guards for multiple actors:

- **Same review, different id:** before inserting, a review is compared with stored reviews of the same property by day (plus or minus one, for time zones), score and text. A match is treated as already stored.
- **Id reused for different reviews** (for example a hotel id in an id field): detected per batch, and the batch falls back to content-based keys so reviews are never merged. The database enforces one row per property and key.

- Same review again: only `last_seen_at` moves. Counted as "unchanged".
- Same review with changed text, score or a new reply: detected by `content_hash`, row updated. Counted as "updated".
- VERIFIED: the 375 stored reviews have 375 distinct keys, and re-ingesting the committed sample creates nothing new (test `sample round trip`).

## New reviews

A property's first run with the current actors is a 12-month backfill (up to `APIFY_BACKFILL_MAX`, default 1,500 reviews). After that, each run asks for reviews published since the newest stored review minus 14 days, newest first, up to `APIFY_MAX_REVIEWS` (default 300). A property is not started again within 6 hours of a run that did not fail, so triggering the job twice is safe: the second call stores the first call's results. For a one-off backfill set `APIFY_SINCE`, for example `APIFY_SINCE=2025-10-10 APIFY_MAX_REVIEWS=1500 npm run collect`.

**VERIFIED problem with the first actor, fixed by switching actors:** the first collection did not return the newest reviews. Three properties got 100 reviews spread over two to three years, with only three adjacent scores each (for example 6, 7 and 8), and nothing from recent weeks. Booking.com shows 2,300 to 4,300 reviews per property and the counts keep rising, so the reviews exist; the actor run simply did not fetch them. The collector now uses actors with a verified-in-listing newest-first sort and a since-date, maps them from each actor's own schema, and falls back to the next actor on stale output.

Until then, the problem is caught in two places:

- Each run whose newest review is more than 21 days old is marked `degraded` with a plain explanation.
- The Data health tab checks every property for stale data and for a suspiciously narrow score band, and the Overview warns staff that those numbers are incomplete.

## Failure handling

| Failure | Behaviour |
|---|---|
| Network error or 5xx starting a run | Retried with backoff (2 attempts, each start is billed); then the fallback actor is tried |
| Run started but could not be recorded | Error names the Apify run id and the `npm run ingest-run` command to recover it |
| Actor run ends FAILED, TIMED-OUT or ABORTED | Run marked `failed` with the reason; no ingest |
| Apify unreachable while ingesting | Run stays `running` and is retried by the next collection; marked `failed` only after 3 days |
| Empty dataset, or no row with a rating | Run marked `degraded`; existing data untouched (likely a page change or block) |
| More than 20% of rows rejected | Run marked `degraded`; rejected rows logged with a reason in `rejected_items` (first 20) |
| Newest review older than 21 days | Run marked `degraded` (actor probably not sorting newest first) |
| One property fails | The others continue |
| Same run ingested twice | Safe: ingest is idempotent |
| AI unavailable or rate-limited | Reviews stay `pending`; rate limits do not use up a review's 3 attempts |

Nothing in collection ever deletes reviews.

## Incidents

**2026-10-10, doubled low scores (fixed).** The normaliser treated any score of 5 or below as a 1 to 5 score and doubled it. The 46 lowest-rated reviews were stored as 8 to 10 out of 10. Code fixed with a regression test; the stored rows were halved back to their real scores. See docs/decisions.md.

## Limitations

- ASSUMED: collecting public review data through a third-party actor is acceptable for this internal use. Booking.com's terms restrict automated collection; volume is kept low and only public data is read.
- The actor can break when Booking.com changes its pages or blocks traffic. Drift shows as `degraded` runs on the Data health tab. The CSV and JSON importer (`npm run import`) is the manual fallback.
- Collection runs once a day and runs are ingested on the next day's cron, so the dashboard can be up to about a day behind.
