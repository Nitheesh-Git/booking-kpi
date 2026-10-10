# Collection method

Status labels: VERIFIED (checked against real data or tests), ASSUMED, UNKNOWN, UNTESTED.

## Why a third-party actor

Booking.com gives us no API access (task brief), and headless browsers cannot run on Vercel. Collection therefore uses a hosted Apify actor that reads the public review pages. Our code only starts runs, reads their datasets and cleans the rows.

Booking.com does run an official Guest Review API for connectivity partners. If Azzurro can get access through its channel manager, it would replace scraping entirely. See ROADMAP.md.

## Sources

| Actor | Role | Scores | Notes |
|---|---|---|---|
| Booking.com Reviews (Apify, about USD 1.5 per 1,000 reviews) | Primary | 10-point, exact | VERIFIED on a 5-review probe, 2026-10-10. Returns score, title, liked and disliked text, publication date, stay dates, country, traveller type, room, nights, reply and a review link with Booking's review id |
| Booking Reviews Scraper (Apify) | Fallback, used only if the primary fails to start | 1 to 5 | VERIFIED probe returned 75 reviews when 5 were requested. Scores are doubled and marked "rounded" |

Both IDs are set in `APIFY_ACTOR_ID` (comma-separated, primary first).

## What is kept

`lib/normalize.js` is the only place source rows become reviews, and it uses an allowlist: rating, title, liked text, disliked text, publication date, stay date, country, traveller type, room, nights, property reply, review link. Reviewer names and any other identifiers are never stored, logged, exported or shown. Text stays in its original language.

The rating scale is set by the source, never guessed from the number (see "Incidents" below).

## Duplicates

Each review gets a `dedupe_key`: Booking's own review id from the review link when present (all primary-actor rows have one), otherwise a hash of property, publication date and text. The database enforces one row per property and key.

- Same review again: only `last_seen_at` moves. Counted as "unchanged".
- Same review with changed text, score or a new reply: detected by `content_hash`, row updated. Counted as "updated".
- VERIFIED: the 375 stored reviews have 375 distinct keys, and re-ingesting the committed sample creates nothing new (test `sample round trip`).

## New reviews

Each daily run asks the actor for up to `APIFY_MAX_REVIEWS` (default 100) reviews per property; anything already stored is recognised and skipped.

**VERIFIED problem, open:** the first collection did not return the newest reviews. Three properties got 100 reviews spread over two to three years, with only three adjacent scores each (for example 6, 7 and 8), and nothing from recent weeks. The primary actor has a sort option, but the collector never sent it. The exact input name is UNKNOWN from this environment because the Apify site was unreachable. Fix: read it from the actor's input schema on Apify and set it, for example `APIFY_INPUT_OVERRIDES={"sortBy":"newest"}`, then rerun with `APIFY_MAX_REVIEWS=400` for a 12-month backfill.

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
