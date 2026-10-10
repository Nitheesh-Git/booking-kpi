# Decisions

## 2026-10-10: P0 actor selection

**Decision:** Use the first configured Apify actor, Booking.com Reviews 1.5/1k, as the primary collector. Keep Booking Reviews Scraper as the fallback.

**Evidence:** A bounded probe of Olympic Hotel Paddington returned exactly five review rows for the primary actor at an observed run cost of about USD 0.013. It provides exact scores on Booking.com's 10-point scale, review date, positive and negative text, country, traveller type, room type, stay dates, reply text and review URL. Its raw response includes a reviewer field, which is deliberately discarded by the privacy allowlist.

The fallback returned a usable nested response with 75 reviews even though its input requested five. Its scores are on a 1 to 5 scale and must be stored as rounded 10-point equivalents. It also includes reviewer names in raw output. These do not disqualify it as a fallback, but make it less predictable for incremental collection and cost control.

**Trade-off:** The primary actor did not expose a dedicated review-id field in its review objects. The implementation will use the existing deterministic content hash dedupe path, with the selected review ID parsed from the review URL only when present.

**Status:** VERIFIED by two real P0 probe runs. Actor behaviour can change and will be rechecked by drift detection.
