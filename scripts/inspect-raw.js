/**
 * inspect-raw — Fetch and pretty-print raw rows from Supabase for debugging.
 *
 * Usage:
 *   npm run inspect -- reviews --limit 5
 *   npm run inspect -- review_topics --limit 20
 *   npm run inspect -- review_enrichment --status pending
 *   npm run inspect -- scrape_runs --limit 5
 */

import { createDatabaseClient } from "../lib/db.js";
import { loadEnvironment } from "../lib/env.js";

const ALLOWED_TABLES = [
  "reviews",
  "review_enrichment",
  "review_topics",
  "scrape_runs",
  "rejected_items",
  "properties",
];

const args = process.argv.slice(2);
const table = args[0];

if (!table || !ALLOWED_TABLES.includes(table)) {
  console.error(
    `Usage: npm run inspect -- <table> [--limit N] [--status <status>]\n` +
      `Tables: ${ALLOWED_TABLES.join(", ")}`,
  );
  process.exit(1);
}

const limitFlag = args.indexOf("--limit");
const statusFlag = args.indexOf("--status");
const limit = limitFlag >= 0 ? Number(args[limitFlag + 1]) : 10;
const status = statusFlag >= 0 ? args[statusFlag + 1] : null;

const db = createDatabaseClient(loadEnvironment());

let query = db.from(table).select("*").limit(limit);
if (status) query = query.eq("status", status);

const { data, error } = await query;
if (error) throw error;

console.log(JSON.stringify(data ?? [], null, 2));
console.log(`\n(${(data ?? []).length} rows from ${table})`);
