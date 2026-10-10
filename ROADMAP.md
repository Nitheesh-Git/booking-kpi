# Roadmap

## Next
1. Set the primary actor's newest-first sort option and run a 12-month backfill (`APIFY_MAX_REVIEWS=400`). Confirm the Data health tab shows all four properties as OK.
2. Hand-label 100 reviews and publish `npm run eval` results in the insights methodology.
3. Deploy with `CRON_SECRET` and watch a week of daily runs.

## Later
- Move to Booking.com's official Guest Review API through Azzurro's channel manager, removing scraping and its terms-of-service risk.
- Weekly email summary to each property manager with its insights and flags.
- Reply tracking: share of negative reviews answered, and time to reply.
- Move dashboard aggregation to SQL views if review volume grows well beyond a few thousand a year.
