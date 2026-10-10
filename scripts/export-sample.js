/**
 * export-sample: write every collected review, with its AI topic tags, to
 * data/sample/reviews.json. The dashboard reads this file when Supabase is
 * not configured, so a fresh clone runs on real data.
 *
 * Reviewer names never reach this file: they are dropped in lib/normalize.js
 * before anything is stored.
 *
 * Usage: npm run export-sample [-- --out path.json]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadEnvironment } from "../lib/env.js";
import { createDatabaseClient } from "../lib/db.js";
import { createSupabaseSource } from "../lib/repository.js";
import { properties } from "../dashboard.config.js";

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const outPath = outFlag >= 0 ? args[outFlag + 1] : "data/sample/reviews.json";

const source = createSupabaseSource(createDatabaseClient(loadEnvironment()));
const reviews = await source.loadReviews({
  fromUtc: "2000-01-01T00:00:00.000Z",
  toUtc: new Date(Date.now() + 86_400_000).toISOString(),
});

const counts = Object.fromEntries(
  properties.map((p) => [p.id, reviews.filter((r) => r.propertyId === p.id).length]),
);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      meta: {
        exportedAt: new Date().toISOString(),
        source: "Booking.com via Apify, ingested into Supabase",
        reviews: reviews.length,
        perProperty: counts,
        note: "Real collected reviews. Reviewer names are never stored. Text is in its original language.",
      },
      reviews,
    },
    null,
    1,
  )}\n`,
);
console.log(`Exported ${reviews.length} reviews to ${outPath}`, counts);
