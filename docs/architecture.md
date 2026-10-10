# Architecture

## Components

| Component | Where it runs | Notes |
|---|---|---|
| Dashboard (`public/`) | Browser | Static HTML, CSS, JS. No framework, no build. Calls only this app's `/api/*` |
| API (`app.js`) | Vercel function, or `server.js` locally | Same handler in both places |
| Analytics (`lib/analytics.js`) | Inside the API | Pure functions: reviews in, dashboard numbers and sentences out |
| Data source (`lib/repository.js`) | Inside the API | Supabase (paged) or `data/sample/reviews.json` |
| Collector (`lib/collect.js`, `lib/apify.js`) | Vercel cron or laptop CLI | Starts Apify runs, ingests finished ones |
| Enrichment (`lib/enrich.js`, `lib/llm.js`) | Laptop CLI | AI topic tagging |
| Database | Supabase Postgres | RLS on every table, no public policies |

## Daily flow

1. Vercel cron calls `GET /api/collect` with `Authorization: Bearer $CRON_SECRET`.
2. The handler ingests every `scrape_runs` row still `running` (the runs started by the previous cron). Each is fetched from Apify, normalized, validated, deduplicated and upserted. Failures are written on the run row.
3. It then starts one Apify run per property and returns immediately, staying inside the function time limit.
4. The cron tags new reviews, handing large backlogs to `/api/enrich` until none are left (`lib/continue-enrich.js`). `npm run enrich` does the same from a laptop. Either can run any time; untagged reviews show "Topics not analysed yet".

Polling on the next cron replaces the planned Apify webhook (see decisions). It has no public-URL or webhook-secret setup and recovers missed runs by design, at the cost of up to a day of lag.

## Read path

`/api/dashboard` resolves the selected and comparison periods in Sydney time (`lib/weeks.js`), loads every review from the earliest date it needs (comparison period, 12 trend weeks, last 7 days for flags) and hands the list to `buildDashboard`. At current volumes (hundreds of reviews a year across four properties) this is a few hundred rows per request. Responses are cached at Vercel's edge for 5 minutes.

`/api/reviews` loads the period's reviews and filters, searches, sorts and pages them with `filterFeed`.

## Why aggregation is in JavaScript, not SQL

The plan suggested SQL functions. With this data size, computing in JavaScript keeps all metric logic in one tested module that works the same against Supabase and the sample file, and needs no extra migration. If volume grew to tens of thousands of reviews per period, the same functions could move into SQL views with the tests kept as the specification.
