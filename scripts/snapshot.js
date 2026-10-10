/**
 * snapshot: print this week's KPIs and insight sentences to the terminal.
 *
 * Usage:
 *   npm run snapshot
 *   npm run snapshot -- --property olympic-paddington
 */

import { properties, timezone } from "../dashboard.config.js";
import { buildDashboard } from "../lib/analytics.js";
import { loadEnvironment } from "../lib/env.js";
import { createSource } from "../lib/repository.js";
import { addDays, localDate, resolvePeriods, startOfLocalDay } from "../lib/weeks.js";

const args = process.argv.slice(2);
const flag = args.indexOf("--property");
const property = flag >= 0 ? args[flag + 1] : null;
if (property && !properties.some((p) => p.id === property)) {
  console.error(`Unknown property: ${property}. Valid: ${properties.map((p) => p.id).join(", ")}`);
  process.exit(1);
}

const source = createSource(loadEnvironment());
if (!source) {
  console.error("No data source. Configure Supabase or add data/sample/reviews.json.");
  process.exit(1);
}

const today = localDate(new Date(), timezone);
const periods = resolvePeriods({ today });
const reviews = await source.loadReviews({
  fromUtc: startOfLocalDay(addDays(today, -120), timezone),
  toUtc: startOfLocalDay(addDays(today, 1), timezone),
});
const d = buildDashboard({ reviews, periods, property, today });
const fmt = (n) => (n == null ? "n/a" : n.toFixed(1));

console.log(`\nThis week (${periods.current.from} to ${periods.current.to}), source: ${source.kind}`);
console.log(`  Average rating : ${fmt(d.summary.current.average)} (${d.summary.current.count} reviews)`);
console.log(`  Previous week  : ${fmt(d.summary.previous.average)} (${d.summary.previous.count} reviews)`);
console.log("\nProperties");
for (const p of d.properties)
  console.log(`  ${p.name.padEnd(26)} ${fmt(p.current.average).padStart(4)}  (${p.current.count})`);
console.log("\nInsights");
for (const i of d.insights) console.log(`  - ${i.text}`);
if (d.attention.length) {
  console.log("\nNeeds attention");
  for (const a of d.attention) console.log(`  ! ${a.title}: ${a.detail}`);
}
