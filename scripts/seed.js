/**
 * seed: load data/sample/reviews.json into a Supabase project, topics included.
 *
 * Lets a reviewer rebuild the full database from the repository without
 * Apify or AI keys. Uses the normal ingest path (normalize, validate, dedupe),
 * so it is idempotent: running it twice creates nothing new.
 *
 * Usage: npm run seed [-- --file path.json]
 */

import { readFileSync } from "node:fs";
import { properties } from "../dashboard.config.js";
import { createDatabaseClient } from "../lib/db.js";
import { loadEnvironment } from "../lib/env.js";
import { ingestPreparedReviews, prepareReviews } from "../lib/ingest.js";

const args = process.argv.slice(2);
const file = args.includes("--file") ? args[args.indexOf("--file") + 1] : "data/sample/reviews.json";
const parsed = JSON.parse(readFileSync(file, "utf8"));
const sample = Array.isArray(parsed) ? parsed : parsed.reviews;
const db = createDatabaseClient(loadEnvironment());

const { data: run, error: runError } = await db
  .from("scrape_runs")
  .insert({ trigger: "import", status: "running" })
  .select("id")
  .single();
if (runError) throw runError;

const totals = { created: 0, updated: 0, unchanged: 0, rejected: 0, tagged: 0 };
for (const property of properties) {
  const items = sample.filter((r) => r.propertyId === property.id);
  if (!items.length) continue;
  const prepared = prepareReviews(items, property.id, new Date(), { ratingScale: 10 });
  const counts = await ingestPreparedReviews(db, run.id, prepared);
  for (const k of ["created", "updated", "unchanged", "rejected"]) totals[k] += counts[k];

  // Carry the sample's AI tags across, matched by the same dedupe key.
  const keyed = new Map(prepared.accepted.map((r, i) => [r.dedupeKey, items[i]]));
  const { data: rows, error } = await db
    .from("reviews")
    .select("id, dedupe_key")
    .eq("property_id", property.id)
    .in("dedupe_key", [...keyed.keys()]);
  if (error) throw error;
  for (const row of rows ?? []) {
    const source = keyed.get(row.dedupe_key);
    if (!source || source.enrichmentStatus !== "done") continue;
    const { error: e1 } = await db.from("review_enrichment").upsert({
      review_id: row.id,
      status: "done",
      sentiment_score: source.sentiment,
      provider: "sample",
      model: "sample",
      enriched_at: new Date().toISOString(),
    });
    if (e1) throw e1;
    await db.from("review_topics").delete().eq("review_id", row.id);
    if (source.topics?.length) {
      const { error: e2 } = await db
        .from("review_topics")
        .insert(source.topics.map((t) => ({ review_id: row.id, ...t })));
      if (e2) throw e2;
    }
    totals.tagged += 1;
  }
}

await db
  .from("scrape_runs")
  .update({ status: "ingested", finished_at: new Date().toISOString(), items_fetched: sample.length, created: totals.created, updated: totals.updated, unchanged: totals.unchanged, rejected: totals.rejected })
  .eq("id", run.id);

console.log(
  `Seed complete: ${totals.created} created, ${totals.updated} updated, ${totals.unchanged} unchanged, ${totals.rejected} rejected, ${totals.tagged} with AI tags.`,
);
