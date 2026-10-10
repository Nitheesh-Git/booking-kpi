# Operations runbook

All commands run from the repository root with `.env` filled in.

## Daily

Nothing to do. The Vercel cron calls `/api/collect` at 19:00 UTC (5 or 6 am Sydney). It ingests the previous day's runs, starts new ones and AI-tags up to 25 reviews. Check the **Data health** tab: every property should show "OK".

## Common tasks

| Task | Command |
|---|---|
| Collect now, from a laptop | `npm run collect` |
| One-off 12-month backfill | `APIFY_SINCE=2025-10-10 APIFY_MAX_REVIEWS=1500 npm run collect` |
| Re-ingest a finished Apify run | `npm run ingest-run -- <apifyRunId>` |
| Tag every pending review | `npm run enrich` |
| Load an export by hand | `npm run import -- file.csv --property potts-point [--scale 10\|5]` |
| Rebuild a database from the repo | Apply the files in `supabase/migrations/` in order, then `npm run seed` |
| Refresh the committed sample | `npm run export-sample` |
| Terminal summary of this week | `npm run snapshot` |
| Check for secrets before pushing | `npm run scan` |

## When something is wrong

| Symptom on Data health | Likely cause | Action |
|---|---|---|
| "No reviews newer than N days" | Actor not sorting newest first, or blocked | The next actor is tried automatically. If all three fail, check the run notes and set fields with `APIFY_INPUT_OVERRIDES` |
| "All N reviews score between X and Y" | Actor returned a filtered slice | As above, then re-collect |
| Run "Failed: Apify run finished as FAILED" | Actor error or block | Open the run on Apify; retry tomorrow; use `npm run import` if it persists |
| Run "Partial: N of M rows rejected" | Page or actor output changed | `npm run inspect -- rejected_items` to see reasons; update `lib/normalize.js` |
| Many reviews "waiting" for analysis | AI rate limits or keys down | `npm run enrich`; check `GROQ_API_KEYS` and `OPENROUTER_API_KEYS` |
| Pill says "Data unavailable" | Database unreachable or keys wrong | Check Supabase status and Vercel environment variables |

## Rotating keys

Update the value in Vercel project settings and in your local `.env`, then redeploy. Several keys per AI provider can be given comma-separated. Never commit `.env`.
