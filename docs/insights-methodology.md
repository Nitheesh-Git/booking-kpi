# Insights methodology

## Topics

Fixed list, defined in `dashboard.config.js`: cleanliness, check-in, staff and reception, noise, facilities, location, room condition, value for money, other. Adding a topic is a configuration change plus a prompt version bump.

## Tagging

`lib/enrich.js` sends each review's title, liked text and disliked text to an LLM at temperature 0 and asks for JSON:

```json
{ "sentiment_score": 0.3,
  "topics": [{ "topic": "cleanliness", "polarity": "negative", "severity": 2, "evidence": "Dirty bathroom" }] }
```

- **Polarity is per topic**, so "great location, dirty room" gives location praise and cleanliness complaint.
- **Severity**: 1 minor, 2 clear, 3 serious (hygiene, safety, billing). Severity 3 in the last 7 days raises a "Needs attention" flag.
- **Validation** (VERIFIED by unit tests): unparseable output or a schema mismatch fails the review, which stays retryable; unknown topics, polarities or severities are dropped.
- **Evidence check** (VERIFIED by unit test, added 2026-10-10): the quote must appear in the review text, ignoring case, spacing and punctuation. Tags that fail are discarded. Tags stored before this check was added were not re-checked. To apply it to everything, set `review_enrichment.status` back to `pending` for analysed reviews and run `npm run enrich` (there is no `--reclassify` flag yet).
- **Prompt version**: a hash of the prompt template is stored with each result, so a prompt change is visible in the data.
- **Providers**: Groq keys in rotation, then OpenRouter keys. Any failure on a key (rate limit, server error, timeout, revoked key) moves to the next key, then the next provider. If every key fails, reviews stay `pending` without using up an attempt and are retried later; ingest never waits on AI.
- **Measured load (2026-10-10)**: 348 reviews tagged on Groq in about 70 minutes, peak 25 per minute, zero failed reviews, OpenRouter never needed. Daily load is about 10 to 30 calls, far inside one free key's limits. Extra keys from the same provider account usually share one limit, so they add redundancy rather than capacity.
- Reviews with no text are marked `skipped` and count towards ratings only.

## Metrics

Ratings, not the AI sentiment score, decide whether a review is positive (8+) or negative (below 6). The rating is what the guest actually gave, so it is the more defensible number for operations staff. The AI sentiment score is stored but not shown.

| Metric | Formula |
|---|---|
| Complaint share | reviews with a complaint tag for the topic / all reviews in the period |
| Share of negative reviews | negative-rated reviews with a complaint tag for the topic / negative-rated reviews |
| Change | complaint share now minus complaint share in the comparison period, in percentage points |

Each percentage on screen shows its counts. With fewer than three negative reviews, the "X% of negative reviews" sentence is written as counts instead ("The only negative review this week mentioned...").

All of this is computed in `lib/analytics.js` as pure functions, covered by `test/analytics.test.js` with hand-checked numbers.

## Insight sentences

`buildInsights` writes up to five sentences, in this order: the rating and its change; the topic most mentioned in negative reviews; the most common complaint if different; a topic whose complaint share rose by 5 points or more with at least 3 complaints; the property that moved most (only when both periods have 5 or more reviews); the most praised topic.

## Evaluation

**UNTESTED: labels pending.** The tooling is ready; the labelling has to be done by a person.

1. `npm run label-template` picks 100 real reviews with text, spread across properties and rating bands, and writes `data/eval/golden.todo.json`. The AI's tags are left out of the file so they cannot bias the labeller.
2. A person adds every topic each review praises or complains about, fills in `labelledBy`, and saves the file as `data/eval/golden.json`.
3. `npm run eval` prints precision and recall per topic and polarity for the AI and for a keyword baseline (`lib/baseline.js`), then the AI's failure cases.

Paste the output here. If the AI does not clearly beat the keyword baseline, the simpler method should be used.

## Known limits

- Sarcasm ("lovely view of the bins") and mixed sentences can be mis-tagged.
- Very short reviews ("ok") give little to tag.
- Non-English reviews are tagged in their original language; quality there is unmeasured.
- Different models tag slightly differently; the provider and model are stored per review.
