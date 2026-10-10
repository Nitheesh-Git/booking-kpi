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

All stored timestamps are UTC instants. Sydney week calculation is added in the reporting migration.
