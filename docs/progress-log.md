# Progress log

## 2026-10-10, P0 started

Done: Read the locked build plan and repository instructions. Created the Vercel-ready JavaScript skeleton with a shared local and serverless health endpoint, an ignored environment file, and a placeholder dashboard page.

Next: Compare Booking.com Apify actors on one property, select an actor based on saved real output, then create the Supabase and Vercel projects.

Blockers: `/home/nitheesh/booking-kpi/.env` is not present and the required service variables are not exposed to the shell. No actor can be selected or real fixture saved until the configured credentials are available to this workspace.

## 2026-10-10, P0 actor comparison

Done: Verified both configured Apify tokens and actors. Compared two real bounded runs on Olympic Hotel Paddington and selected Booking.com Reviews 1.5/1k as primary. Saved a privacy-safe fixture with five real reviews, excluding reviewer names. Documented the selection and fallback limitations.

Next: Verify Supabase connectivity, create the project schema and deploy the local health endpoint to Vercel.

Blockers: Supabase is reachable. Vercel CLI is installed but not authenticated, so the required hello-endpoint deployment cannot yet be completed. The currently configured `PUBLIC_BASE_URL` is intentionally blank for local testing, so the Apify webhook path will be added after the first deployment.

## 2026-10-10, P0 complete

Done: Deployed and verified the health endpoint on Vercel. Added all configured server-only production variables through Vercel's secret store. Confirmed the primary actor has a count cap, sorting input and publication dates, while its date cutoff must be enforced by the application.

Next: Build the Supabase schema, normalizer, validator, dedupe key, idempotent ingest path and CSV or JSON import fallback.

Blockers: The production deployment currently has Vercel Authentication protection enabled. It does not block development, but it must be disabled before the final public demo.

## 2026-10-10, P1 implementation ready

Done: Added the Supabase migration, privacy-safe canonical review model, validation, deterministic dedupe and content hashes, idempotent ingestion path, CSV or JSON import command and fixture-based tests. `npm test` and `npm run lint` pass.

Next: Apply the migration to the configured Supabase project, run the fixture import twice and verify that the second import creates no new reviews.

Blockers: The Supabase CLI is not installed and no database connection string or Supabase management access token is configured. The service role key can access data but cannot apply DDL through the REST API.

## 2026-10-10, P1 complete

Done: Authenticated and linked the Supabase CLI, then applied `0001_init.sql` to the configured project. Imported the real five-review fixture twice. The first import created five reviews, and the second created zero, updated zero and marked five unchanged.

Next: Build the Apify client, run lifecycle, retry policy, recovery path and four-property backfill.

Blockers: None for P2. The public demo deployment protection remains a later release task.

## 2026-10-10, P2 complete

Done: Implemented Apify client with fallback actor failover, run lifecycle tracking in `scrape_runs`, bounded retries, per-property failure isolation, and completed 4-property backfill with 374 real reviews ingested without rejection.

Next: Build LLM enrichment pipeline (Groq multi-key rotation and OpenRouter fallback), topic tagging, sentiment analysis, and operations KPI calculation.

Blockers: None.

## 2026-10-10, P3 complete

Done: Completed 100% review enrichment across all 375 reviews (348 enriched, 27 properly skipped for empty text, 0 failures) generating 1,000 explainable topic evidence quotes. Implemented dashboard reporting API layer (`lib/api.js`) and endpoints (`/api/properties`, `/api/kpis`, `/api/reviews`, `/api/runs`) with CORS support and Vercel routing compatibility. Created the interactive responsive frontend dashboard (`public/index.html`, `public/style.css`, `public/dashboard.js`) with property/window filters, KPI cards, operations topic insights, weekly rating trends, and paginated customer reviews feed. Added 32 passing unit tests and verified clean ESLint checks.

Next: Deploy updated application to Vercel and verify production endpoints and UI.

Blockers: None.

## 2026-10-10, review against the brief and dashboard rebuild

Done: Audited the code against the brief. Fixed: dashboard had no current-week rating, no week-on-week comparison, no property breakdown, no positive and negative trend, no insight sentences, and the date filter did not apply to the feed; weeks were bucketed in UTC instead of Sydney time; Supabase reads could silently stop at 1,000 rows; review text was injected into the page unescaped; a failing API test; failed or empty Apify runs were left as "running". Rebuilt the dashboard (Overview, Reviews, Data health), added the daily cron endpoint with fail-closed auth, the AI evidence check, a secret scanner, README, architecture and methodology docs. 53 tests and lint pass.

Next: Export real data to `data/sample/reviews.json` with `npm run export-sample`, deploy to Vercel with `CRON_SECRET` set, and build the hand-labelled evaluation set.

Blockers: The golden evaluation set needs human labelling.

## 2026-10-10, data quality fixes

Done: Found and fixed a rating bug that stored the 46 worst reviews as 8 to 10 out of 10; corrected those rows in the database. Found the collector is not fetching the newest reviews (newest stored review at Potts Point is 26 July); added a run-level check that flags this and made the actor input configurable. The daily cron now also AI-tags new reviews. Built the accuracy-test tooling (label template, keyword baseline, precision and recall). 61 tests pass.

Next: Set the actor's newest-first sort option and rerun collection with a larger review cap; export the sample data; deploy; hand-label 100 reviews.

Blockers: This build environment cannot reach Apify, Groq or Vercel, and database reads were blocked by a permission guard after the correction, so collection, export and deploy must be run from a laptop.

## 2026-10-10, deep validation

Done: Exported the real sample (375 reviews, 1,340 topic tags) and ran the dashboard on it. Found three properties' data is a filtered slice (100 reviews over years, only three adjacent scores, nothing recent); added per-property data checks that warn staff on screen. A full code review found 22 issues; fixed the real ones (health status missing failures, wrong rating scale when actors share a token, transient Apify errors losing paid runs, rate limits failing reviews, cron overrunning 60 s, prompt corruption by "$" in reviews, skewed AI evaluation). Seed now rebuilds the database from the sample. Added known-unknowns, operations runbook, changelog and roadmap. 73 tests and lint pass.

Next: Set the actor's newest-first sort, backfill 12 months, deploy, hand-label 100 reviews.

Blockers: This environment cannot reach Apify, Groq or Vercel directly, and the Vercel connector lacks access to the project's team scope.

## 2026-10-10, deployed

Done: Deployed to production at https://booking-kpi.vercel.app. Fixed a deploy-only bug (the function could not find the sample file because Vercel runs it from another directory). Moved the function to Singapore, next to the database. Verified on production: health reads Supabase, figures match an independent recalculation, the collection endpoint returns 401 without the secret. The daily cron is now active.

Next: Set the actor's newest-first sort and re-collect; merge this branch into main so the production branch matches.

Blockers: None for deployment.

## 2026-10-10, homepage fix on Vercel

Done: The production homepage returned {"error":"Not found"} because the Vercel project was detected as a Node server, sending every request to the API function. `vercel.json` now pins the framework to Other with `public/` as static output, so the dashboard is served as static files and only `/api/*` reaches the function. Tested on a preview first, then deployed to production; https://booking-kpi.vercel.app/ serves the dashboard.

Next: Merge this branch into main, fix the actor's newest-first sort and re-collect.

Blockers: None.

## 2026-10-10, actor fallback chain

Done: Confirmed from public data that the missing reviews exist on Booking.com (2,300 to 4,300 per property, counts rising), so the first actor was at fault. Replaced it with three actors from different vendors in fallback order: apt_marble, omkar-cloud, scrapeunblocker. Input is built from each actor's published schema; runs are incremental from the newest stored review; a property falls through to the next actor on failure, empty or stale output, or a wrong-looking scale; reviews are matched across actors so none are stored twice. Added migration 0002 (run actor and property). 94 tests pass.

Next: Run the 12-month backfill with the new actors and confirm the Data health tab shows all four properties as OK.

Blockers: This environment cannot reach Apify, so the first live run happens on the daily cron or from a laptop.

## 2026-10-10, first runs with the new actors

Done: Triggered collection from the Vercel dashboard. apt_marble worked for Olympic Paddington (75 reviews, all already stored) and failed for the other three; the chain fell back to omkar-cloud automatically, which back-filled 12 months: Potts Point +287, Central Sydney +241, Darling Harbour +635 reviews, newest now 6 to 10 October, full 1 to 10 score range. Caught and fixed an update that blanked fields the new actor does not send (data restored and verified by checksum). Mapped omkar-cloud's nested reply, guest country and stay fields.

Next: Re-read the stored Apify results with the new mapping to fill replies and stay details (no new scraping cost), then tag the new reviews with AI.

Blockers: About 1,100 new reviews need AI tagging; the daily job tags 25 per run, so a one-off `npm run enrich` is needed.
