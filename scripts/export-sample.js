/**
 * export-sample — Export a privacy-safe JSON sample from the live database.
 *
 * Useful for sharing KPI fixtures or updating test data without exposing
 * reviewer names (the normalizer already strips those at ingest time).
 *
 * Usage:
 *   npm run export-sample
 *   npm run export-sample -- --property olympic-paddington --limit 10
 *   npm run export-sample -- --out data/fixtures/my-sample.json
 */

import { writeFileSync } from "node:fs";
import { createDatabaseClient } from "../lib/db.js";
import { loadEnvironment } from "../lib/env.js";
import { properties } from "../dashboard.config.js";

const args = process.argv.slice(2);
const propertyFlag = args.indexOf("--property");
const limitFlag = args.indexOf("--limit");
const outFlag = args.indexOf("--out");

const propertyId = propertyFlag >= 0 ? args[propertyFlag + 1] : null;
const limit = limitFlag >= 0 ? Number(args[limitFlag + 1]) : 20;
const outPath =
  outFlag >= 0
    ? args[outFlag + 1]
    : `data/fixtures/export-${Date.now()}.json`;

if (propertyId && !properties.find((p) => p.id === propertyId)) {
  console.error(
    `Unknown property: ${propertyId}\nValid: ${properties.map((p) => p.id).join(", ")}`,
  );
  process.exit(1);
}

const db = createDatabaseClient(loadEnvironment());

let query = db
  .from("reviews")
  .select(
    `property_id, rating_10, rating_scale, rating_precision,
     title, liked_text, disliked_text, review_date, stay_date,
     reviewer_country, traveller_type, room_name, nights,
     reply_text, review_url, source`,
  )
  .order("review_date", { ascending: false })
  .limit(limit);

if (propertyId) query = query.eq("property_id", propertyId);

const { data, error } = await query;
if (error) throw error;

writeFileSync(outPath, JSON.stringify(data ?? [], null, 2), "utf8");
console.log(`Exported ${(data ?? []).length} reviews to ${outPath}`);
