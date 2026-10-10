/**
 * seed — Insert a small set of synthetic-free fixture reviews for local dev.
 *
 * Reads the real privacy-safe fixture from data/fixtures/ and imports it
 * using the standard ingest path. Safe to run multiple times (idempotent).
 *
 * Usage: npm run seed
 */

import { readFileSync } from "node:fs";
import { createDatabaseClient } from "../lib/db.js";
import { loadEnvironment } from "../lib/env.js";
import { ingestPreparedReviews, prepareReviews } from "../lib/ingest.js";

const FIXTURE = "data/fixtures/apify-primary-olympic-paddington.json";

const db = createDatabaseClient(loadEnvironment());

const { data: run, error: runError } = await db
  .from("scrape_runs")
  .insert({ trigger: "import", status: "running" })
  .select("id")
  .single();
if (runError) throw runError;

const items = JSON.parse(readFileSync(FIXTURE, "utf8"));
const prepared = prepareReviews(items, "olympic-paddington");
const counts = await ingestPreparedReviews(db, run.id, prepared);

await db
  .from("scrape_runs")
  .update({
    status: "ingested",
    finished_at: new Date().toISOString(),
    items_fetched: items.length,
    ...counts,
  })
  .eq("id", run.id);

console.log(
  `Seed complete: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged.`,
);
