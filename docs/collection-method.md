# Collection method

## Current status

**VERIFIED:** The primary source is an Apify Booking.com review actor, tested against Olympic Hotel Paddington on 2026-10-10. The saved fixture was generated from this real run and excludes reviewer names.

## Primary source

The primary collector accepts Booking.com property URLs and returns structured review rows. The normalizer will allow only the fields needed for operations reporting: score, published date, title, positive text, negative text, stay dates, country, traveller type, room type, nights, property reply and review URL.

The actor's reviewer field is never stored, logged, exported or displayed. Reviews retain their original language.

**VERIFIED:** The actor supports a review count cap and a review-sort input. It provides review publication dates, but no date cutoff was verified in its input schema. Incremental runs will request newest-first reviews, apply the 14-day overlap in the application, and stop ingesting once reviews are older than the per-property cutoff. This is safe but may retrieve a small number of already-seen reviews.

## Fallback source

A second configured Apify actor is retained as a fallback. In its P0 probe it returned 75 reviews despite a requested five-review limit and emitted 1 to 5 ratings. It will only be used if the primary actor fails, and its results will be marked as rounded when converted to the 10-point dashboard scale.

## Reliability controls

The later collection implementation will use a 14-day overlap, deterministic deduplication, retries with bounded backoff, collection-run status records, validation and a rejection log. An empty or malformed collection will never delete existing reviews. Parser drift is surfaced when rejections are high or an established property unexpectedly produces no results.

## Limitations

**ASSUMED:** Public Booking.com data may be collected through the selected third-party actor in accordance with relevant Booking.com and Apify terms. Anti-bot controls, page changes, availability, pricing and returned fields can change without notice. The CSV and JSON importer is the operational fallback when collection is unavailable.
