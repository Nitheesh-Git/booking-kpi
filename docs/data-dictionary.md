# Data dictionary

## Privacy boundary

`lib/normalize.js` is the only source-to-canonical mapping point. It uses an allowlist and deliberately excludes reviewer names, avatars and other identifiers.

## Core tables

| Table               | Purpose                                                         |
| ------------------- | --------------------------------------------------------------- |
| `properties`        | The four configured Booking.com properties.                     |
| `reviews`           | Canonical, privacy-safe review information and dedupe metadata. |
| `scrape_runs`       | Audit record of every actor or import run.                      |
| `rejected_items`    | First 20 privacy-safe validation failures from a run.           |
| `review_enrichment` | AI enrichment state for each review.                            |
| `review_topics`     | Explainable topic tags and evidence.                            |

All stored timestamps are UTC instants. Weeks (Monday to Sunday, Sydney time, daylight saving included) are computed when reading, in `lib/weeks.js`, never with the server's time zone.

## Key fields

| Table.field | Meaning |
|---|---|
| `reviews.rating_10` | The guest's score out of 10 |
| `reviews.rating_scale`, `rating_precision` | 10 and `exact` for the primary actor; 5 and `rounded` for the fallback actor, whose 1 to 5 score is doubled |
| `reviews.dedupe_key` | Booking's review id from the review link, or a hash of property, date and text. Unique per property |
| `reviews.content_hash` | Detects edited text, changed scores and new replies |
| `reviews.review_date` | When the review was published on Booking.com |
| `reviews.first_seen_at`, `last_seen_at` | When collection first and last returned the review |
| `review_enrichment.status` | `pending`, `done`, `failed` (after 3 attempts) or `skipped` (no text) |
| `review_topics.polarity`, `severity`, `evidence` | Praise or complaint; 1 minor to 3 serious; a quote that must appear in the review |
| `scrape_runs.status` | `queued`, `running`, `ingested`, `degraded` (finished with a problem, see `error`) or `failed` |

## Sample file

`data/sample/reviews.json` holds `{ meta, reviews }`. Each review uses the API's shape: `id, propertyId, rating, ratingPrecision, reviewDate, title, liked, disliked, stayDate, country, travellerType, roomName, nights, reply, reviewUrl, enrichmentStatus, sentiment, topics[]`. There is no reviewer name field.
