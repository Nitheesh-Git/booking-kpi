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
