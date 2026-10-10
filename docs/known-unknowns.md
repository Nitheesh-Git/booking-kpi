# Known unknowns

What has not been verified, and the evidence that would settle it.

| Item | Status | Evidence needed |
|---|---|---|
| Primary actor's newest-first sort option name | UNKNOWN | Read the actor's input schema on Apify; run once with it and confirm the newest stored review matches what Booking.com shows today |
| Whether the 100 stored reviews per property at Potts Point, Central Sydney and Darling Harbour are a filtered slice (only 3 adjacent scores each) | VERIFIED as suspicious, cause UNKNOWN | Re-collect with newest-first sort; compare the score spread with the property page |
| The 23 Potts Point reviews restored to 5/10 after the doubling bug | ASSUMED correct (they came from the primary actor, whose scores are out of 10) | Spot-check a few review links on Booking.com |
| AI topic accuracy (precision and recall) | UNTESTED | 100 hand labels in `data/eval/golden.json`, then `npm run eval` |
| AI tagging quality on non-English reviews | UNTESTED | Include some non-English reviews in the hand-labelled set |
| Tags stored before the evidence check existed | UNTESTED | Re-run enrichment on all reviews (see insights methodology) |
| Daily Vercel cron running end to end in production | UNTESTED | A day of `scrape_runs` rows with trigger `cron` after deploying with `CRON_SECRET` |
| Vercel Hobby limits (60 s function, daily cron) | ASSUMED | Vercel plan page |
| Booking.com terms allow this collection for internal use | ASSUMED | Legal review, or move to the official Guest Review API |
| Booking.com Guest Review API availability for Azzurro | UNKNOWN | Ask Azzurro's channel manager or Booking.com account manager |
