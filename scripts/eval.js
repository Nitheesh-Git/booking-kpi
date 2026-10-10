/**
 * eval — Evaluate enrichment quality on a sample of reviews.
 *
 * Prints a table of the most-recent 20 enriched reviews with their
 * LLM sentiment, detected topics, and the raw rating for comparison.
 *
 * Usage:
 *   npm run eval
 *   npm run eval -- --property olympic-paddington
 *   npm run eval -- --limit 50
 */

import { createDatabaseClient } from "../lib/db.js";
import { loadEnvironment } from "../lib/env.js";
import { properties } from "../dashboard.config.js";

const args = process.argv.slice(2);
const propertyFlag = args.indexOf("--property");
const limitFlag = args.indexOf("--limit");

const propertyId = propertyFlag >= 0 ? args[propertyFlag + 1] : null;
const limit = limitFlag >= 0 ? Number(args[limitFlag + 1]) : 20;

const db = createDatabaseClient(loadEnvironment());

let reviewQuery = db
  .from("reviews")
  .select(
    `id, property_id, rating_10, review_date, title, liked_text, disliked_text,
     review_enrichment!inner ( sentiment_score, provider, model, status ),
     review_topics ( topic, polarity, severity )`,
  )
  .eq("review_enrichment.status", "done")
  .order("review_date", { ascending: false })
  .limit(limit);

if (propertyId) reviewQuery = reviewQuery.eq("property_id", propertyId);

const { data, error } = await reviewQuery;
if (error) throw error;

const rows = data ?? [];

const label = propertyId
  ? properties.find((p) => p.id === propertyId)?.name ?? propertyId
  : "ALL PROPERTIES";

console.log(`\n── Enrichment Eval: ${label} (${rows.length} reviews) ──\n`);

for (const row of rows) {
  const enrich = Array.isArray(row.review_enrichment)
    ? row.review_enrichment[0]
    : row.review_enrichment;
  const topicList = (row.review_topics ?? [])
    .map((t) => `${t.polarity === "negative" ? "–" : "+"}${t.topic}`)
    .join(", ");

  const sentStr =
    enrich?.sentiment_score != null
      ? Number(enrich.sentiment_score).toFixed(2)
      : "–";

  console.log(
    `[${row.review_date?.slice(0, 10)}]  ` +
      `rating:${Number(row.rating_10).toFixed(1)}  ` +
      `sentiment:${sentStr}  ` +
      `${topicList || "(no topics)"}`,
  );
  if (row.title) console.log(`  Title   : ${row.title}`);
  if (row.liked_text) console.log(`  Liked   : ${row.liked_text.slice(0, 120)}`);
  if (row.disliked_text) console.log(`  Disliked: ${row.disliked_text.slice(0, 120)}`);
  console.log();
}

console.log(`Provider distribution:`);
const providerCounts = {};
for (const row of rows) {
  const provider =
    (Array.isArray(row.review_enrichment)
      ? row.review_enrichment[0]
      : row.review_enrichment)?.provider ?? "unknown";
  providerCounts[provider] = (providerCounts[provider] ?? 0) + 1;
}
for (const [provider, count] of Object.entries(providerCounts)) {
  console.log(`  ${provider}: ${count}`);
}
console.log();
