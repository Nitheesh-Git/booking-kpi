/**
 * scan — Print a quick KPI snapshot to the terminal.
 *
 * Usage:
 *   npm run scan
 *   npm run scan -- --property olympic-paddington
 *   npm run scan -- --days 30
 */

import { createDatabaseClient } from "../lib/db.js";
import { loadEnvironment } from "../lib/env.js";
import { ratingKpis, topicKpis, trendKpis, sentimentKpis } from "../lib/kpi.js";
import { properties } from "../dashboard.config.js";

const args = process.argv.slice(2);
const propertyFlag = args.indexOf("--property");
const daysFlag = args.indexOf("--days");

const propertyId = propertyFlag >= 0 ? args[propertyFlag + 1] : null;
const windowDays = daysFlag >= 0 ? Number(args[daysFlag + 1]) : 90;

if (propertyId && !properties.find((p) => p.id === propertyId)) {
  console.error(
    `Unknown property: ${propertyId}\nValid IDs: ${properties.map((p) => p.id).join(", ")}`,
  );
  process.exit(1);
}

const db = createDatabaseClient(loadEnvironment());
const label = propertyId
  ? properties.find((p) => p.id === propertyId)?.name ?? propertyId
  : "ALL PROPERTIES";

console.log(`\n── KPI Snapshot: ${label} (last ${windowDays} days) ──\n`);

// Rating
const rating = await ratingKpis(db, propertyId, windowDays);
console.log("RATING");
console.log(`  Average     : ${rating.averageRating ?? "–"} / 10`);
console.log(`  Total       : ${rating.totalReviews}`);
console.log(`  Positive ≥8 : ${rating.positiveCount} (${pct(rating.positiveRate)})`);
console.log(`  Neutral     : ${rating.neutralCount}`);
console.log(`  Negative <6 : ${rating.negativeCount} (${pct(rating.negativeRate)})`);

// Sentiment
const sentiment = await sentimentKpis(db, propertyId, windowDays);
console.log("\nSENTIMENT (LLM)");
console.log(
  `  Average     : ${sentiment.averageSentiment != null ? sentiment.averageSentiment.toFixed(2) : "–"} / 1.0`,
);
console.log(`  Enriched    : ${sentiment.enrichedCount}`);

// Topics
const topics = await topicKpis(db, propertyId, windowDays);
if (topics.length) {
  console.log("\nTOP TOPICS");
  for (const t of topics.slice(0, 8)) {
    const bar = "▓".repeat(Math.round(t.negativeRate * 10)) + "░".repeat(10 - Math.round(t.negativeRate * 10));
    console.log(
      `  ${t.topic.padEnd(20)} ${String(t.total).padStart(4)} mentions  neg:${pct(t.negativeRate)}  ${bar}`,
    );
  }
} else {
  console.log("\nTOP TOPICS: (none yet — run enrichment first)");
}

// Trend (last 8 weeks)
const trend = await trendKpis(db, propertyId, 8);
if (trend.length) {
  console.log("\nWEEKLY TREND (avg rating)");
  for (const w of trend) {
    const bar = "█".repeat(Math.round(w.averageRating));
    console.log(`  ${w.weekStart}  ${w.averageRating.toFixed(1)}  ${bar}  (${w.count})`);
  }
}

console.log();

function pct(rate) {
  return rate != null ? `${(rate * 100).toFixed(0)}%` : "–";
}
