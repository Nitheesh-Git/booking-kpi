# Azzurro Review Insights

Collects public Booking.com guest reviews for four Azzurro Hotels properties in Sydney, and turns them into a dashboard that operations staff can read without training: this week's rating, how it compares with last week, how each property is doing, and what guests keep complaining about.

| Property | Booking.com page |
|---|---|
| Olympic Hotel Paddington | [olympic-paddington](https://www.booking.com/hotel/au/olympic-paddington.html) |
| Potts Point | [venus-potts-point-sydney](https://www.booking.com/hotel/au/venus-potts-point-sydney.html) |
| Central Sydney | [venus-surry-hills](https://www.booking.com/hotel/au/venus-surry-hills.html) |
| Darling Harbour | [chateau-de-venus](https://www.booking.com/hotel/au/chateau-de-venus.html) |

## Quick start

Requires Node 20 or newer.

```bash
npm install
cp .env.example .env        # fill in values, see "Configuration"
npm test                    # unit tests, no network needed
npm run dev                 # http://localhost:3000
```

Without Supabase credentials the dashboard reads `data/sample/reviews.json` (real collected reviews exported with `npm run export-sample`). With credentials it reads the live database.

### Collecting reviews

```bash
npm run collect                       # start one Apify run per property, wait, ingest
npm run enrich                        # AI topic tagging for new reviews
npm run export-sample                 # refresh data/sample/reviews.json from the database
npm run ingest-run -- <apifyRunId>    # re-ingest a finished Apify run
npm run import -- file.csv --property darling-harbour   # fallback: load an export by hand
npm run snapshot                      # this week's KPIs and insights in the terminal
npm run scan                          # check for key-like strings before pushing
```

In production a daily Vercel cron calls `GET /api/collect` (protected by `CRON_SECRET`). Each call first ingests the runs started the day before, then starts new ones. See [docs/collection-method.md](docs/collection-method.md).

## What the dashboard shows

**Overview tab**

- **Average rating** for the selected period (default: this week to date, Sydney time) with the change against last week, shown with an arrow, a sign and words, not just colour.
- **Reviews published**, split into positive (8+), neutral and negative (below 6).
- **Negative reviews** as a share, with counts ("3 of 23 reviews").
- **Top complaint** with a link straight to those reviews.
- **What stands out**: three to five plain sentences written from the numbers, for example *"40% of negative reviews this week mentioned cleanliness issues (2 of 5)."*
- **Needs attention**: rating drops of 0.5 points or more, a topic's complaints rising by 10 points or more, three negative reviews at one property in 7 days, and serious issues (hygiene, safety, billing).
- **Properties table**: rating, change, volume, share negative and a 12-week sparkline per property. Click a row to focus the whole dashboard on that property. Fewer than 5 reviews shows a "Few reviews" badge.
- **Weekly trends**: positive, neutral and negative reviews per week, and average rating per week, over 12 weeks, with the selected period shaded and a written summary under each chart.
- **Complaint topics**: cleanliness, check-in, staff and reception, noise, facilities, location, room condition, value for money. Click a topic to read those reviews.

**Reviews tab**: every review with its rating, property, date, traveller type, country, room, what the guest liked and disliked, AI topic tags, the property's reply and a link to the original. Search, rating filter, topic filter, sort and "load more".

**Data health tab**: per property, how many reviews are stored, the newest review, when data was last collected, how many reviews are analysed, and the outcome of recent collection runs.

Filters (property and period, including a custom date range) apply across tabs and are kept in the URL, so a filtered view can be shared as a link.

## Architecture

```mermaid
flowchart LR
  CRON[Vercel cron, daily] --> COLLECT[/api/collect/]
  COLLECT -->|1. ingest finished runs| APIFY[(Apify Booking.com actor)]
  COLLECT -->|2. start new runs| APIFY
  COLLECT --> DB[(Supabase Postgres)]
  CLI[npm run collect / enrich / import] --> APIFY
  CLI --> DB
  CLI --> AI[Groq, OpenRouter fallback]
  DB --> API[/api/dashboard, /api/reviews, /api/health/]
  SAMPLE[data/sample/reviews.json] -.when no database.-> API
  API --> UI[public/ dashboard]
```

| Path | Role |
|---|---|
| `app.js` | One request handler, shared by `server.js` (local) and `api/index.js` (Vercel) |
| `dashboard.config.js` | Properties, topics and their labels, thresholds, time zone, attention rules |
| `lib/analytics.js` | Every dashboard number and sentence, as pure functions over a list of reviews |
| `lib/weeks.js` | Sydney calendar maths: weeks start Monday, daylight saving handled |
| `lib/repository.js` | Data sources: Supabase (paged reads) or the sample file |
| `lib/normalize.js`, `lib/validate.js`, `lib/dedupe.js`, `lib/ingest.js` | Source row to clean, privacy-safe review; validation; duplicate detection; idempotent upsert |
| `lib/apify.js`, `lib/collect.js` | Starting runs with retries and actor failover, ingesting finished runs, recovering stuck ones |
| `lib/enrich.js`, `lib/llm.js` | AI topic tagging with key rotation, provider fallback and an evidence check |
| `lib/auth.js` | Timing-safe secret check, fails closed |
| `public/` | Dashboard: plain HTML, CSS and JavaScript, no build step, charts drawn as inline SVG |
| `supabase/migrations/` | Database schema, row level security on every table |

More detail: [docs/architecture.md](docs/architecture.md).

## How reviews are collected

Booking.com has no public review API, so collection uses a third-party Apify actor that reads the public review pages. Our code never drives a browser.

- **Fields kept**: rating (10-point scale), title, liked text, disliked text, publication date, stay date, country, traveller type, room, nights, the property's reply, review link. Reviewer names are dropped in `lib/normalize.js` and never stored.
- **No duplicates**: each review gets a key, Booking's review id from the review link when present, otherwise a hash of property, date and text. The database enforces one row per property and key. Re-collecting the same review only updates "last seen"; an edited review or a new reply is detected by a content hash and updated.
- **New reviews**: each run asks for the newest 100 reviews per property. Anything already stored is recognised and skipped, so daily runs only add what is new.
- **Failures**: bounded retries with backoff on network errors; a fallback actor if the primary one cannot start; a failed, empty or mostly rejected run is recorded as `failed` or `degraded` and existing data is never deleted or overwritten; runs left `running` are picked up on the next collection; invalid rows are rejected with a reason and logged, without stopping the run.
- **Fallback**: `npm run import` loads a CSV or JSON export through the same validation path.

Full write-up, including reliability and terms-of-service considerations: [docs/collection-method.md](docs/collection-method.md).

## How topics are found

An AI model (Groq, with OpenRouter as fallback) reads each review's title, liked and disliked text and returns topics, each with a polarity (complaint or praise), a severity from 1 to 3 and a short quote as evidence. Tags whose quote does not appear in the review are thrown away, which blocks invented tags. Reviews with no text are counted by rating only. Method and limits: [docs/insights-methodology.md](docs/insights-methodology.md).

## Metric definitions

| Metric | Definition |
|---|---|
| Review date | When the review was published on Booking.com |
| Week | Monday to Sunday, Sydney time |
| Average rating | Mean score out of 10 of reviews published in the period |
| Comparison | "This week" is compared with all of last week; other periods with the period of the same length just before |
| Positive / negative | 8 or more / below 6. Configurable in `dashboard.config.js` |
| Complaint share (topic) | Reviews with a complaint about the topic, divided by all reviews in the period |
| Share of negative reviews (topic) | Negative reviews with a complaint about the topic, divided by all negative reviews |
| Few reviews | Fewer than 5 reviews in the period. Flagged, never hidden |

## Configuration

| Variable | Needed for |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Live data. Server-side only |
| `APIFY_API_TOKEN`, `APIFY_ACTOR_ID` | Collection. Comma-separated actor IDs give a fallback order |
| `GROQ_API_KEYS`, `OPENROUTER_API_KEYS` | AI topic tagging |
| `CRON_SECRET` | Enables `GET /api/collect`. Unset means the endpoint returns 503 |
| `SAMPLE_DATA_PATH` | Optional alternative data file when Supabase is not configured |

Database setup: create a Supabase project and run `supabase/migrations/0001_init.sql`.

## Deploying

Vercel only: static files from `public/`, one function (`api/index.js`) and a daily cron (`vercel.json`). Add the variables above in the Vercel project settings, then `vercel deploy --prod`. Make sure Vercel Deployment Protection is off for the public demo.

## Known limitations

- **Third-party collector.** Collection depends on an Apify actor that can break when Booking.com changes its pages or blocks traffic. Drift shows up as `degraded` runs on the Data health tab; the CSV and JSON importer is the manual fallback. Automated collection may be restricted by Booking.com's terms; only public data is read, at low volume.
- **100 newest reviews per run.** If a property ever receives more than 100 reviews between two runs, the oldest of those would be missed. At current volumes (a few a day) this is not a concern. Whether the actor returns reviews strictly newest first has not been independently verified (UNKNOWN).
- **Collection lag.** The cron starts runs one day and ingests them the next, so the dashboard is up to about a day behind Booking.com.
- **AI tagging is not perfect.** Sarcasm, mixed sentences and very short reviews are hard. A hand-labelled evaluation set has not been built yet, so precision and recall are not measured (see the methodology doc).
- **Low volumes.** Each property gets only a handful of reviews a week, so weekly averages move a lot. The dashboard flags small samples instead of hiding them.
- **Sample data.** `data/sample/reviews.json` must be refreshed from the database with `npm run export-sample`; it is not committed until real collected data is exported.

## Security and privacy

- No secrets in the repository; `.env` is ignored and `npm run scan` checks for key-like strings.
- The browser never talks to Supabase. Every table has row level security on with no public policies; the server uses the service role key.
- Reviewer names are never stored, logged or shown. Review text is kept in its original language.
- All review text is escaped before display.

## Documentation

| File | Content |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Components and data flow |
| [docs/collection-method.md](docs/collection-method.md) | Source, dedupe, incremental updates, failure handling, limits |
| [docs/insights-methodology.md](docs/insights-methodology.md) | Topic tagging, validation, metrics, limits |
| [docs/decisions.md](docs/decisions.md) | Decisions and their trade-offs |
| [docs/data-dictionary.md](docs/data-dictionary.md) | Tables and fields |
| [docs/progress-log.md](docs/progress-log.md) | Timestamped progress updates |

## License

MIT, see [LICENSE](LICENSE).
