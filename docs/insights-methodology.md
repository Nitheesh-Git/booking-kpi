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
- **Providers**: Groq with key rotation on rate limits, then OpenRouter. If every provider fails, reviews stay `pending` and are retried later; ingest never waits on AI.
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

**UNTESTED.** Precision and recall have not been measured. The plan calls for about 100 hand-labelled reviews in `data/eval/golden.json` and a comparison of the AI against a keyword baseline. This needs a human to label the reviews and has not been done. `npm run eval` currently prints recent tagged reviews side by side with their ratings for manual spot checks only.

## Known limits

- Sarcasm ("lovely view of the bins") and mixed sentences can be mis-tagged.
- Very short reviews ("ok") give little to tag.
- Non-English reviews are tagged in their original language; quality there is unmeasured.
- Different models tag slightly differently; the provider and model are stored per review.
