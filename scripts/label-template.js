/**
 * label-template: pick about 100 real reviews for a person to label by hand.
 *
 * Writes data/eval/golden.todo.json. The labeller fills each review's
 * "labels" with { topic, polarity } pairs (topics from dashboard.config.js),
 * sets "labelledBy", then saves the file as data/eval/golden.json.
 * The AI's own tags are deliberately left out so they cannot bias the labels.
 *
 * Usage: npm run label-template [-- --count 100]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { properties, topics } from "../dashboard.config.js";
import { ratingBand } from "../lib/analytics.js";
import { loadEnvironment } from "../lib/env.js";
import { createSource } from "../lib/repository.js";

const args = process.argv.slice(2);
const count = Number(args.includes("--count") ? args[args.indexOf("--count") + 1] : 100);
const source = createSource(loadEnvironment());
if (!source) throw new Error("No data source. Configure Supabase or add data/sample/reviews.json.");

const all = (await source.loadReviews({ fromUtc: "2000-01-01T00:00:00Z", toUtc: "2100-01-01T00:00:00Z" }))
  .filter((r) => r.title || r.liked || r.disliked)
  .sort((a, b) => a.id.localeCompare(b.id));

// Stratify by property and rating band so complaints are well represented.
const buckets = new Map();
for (const r of all) {
  const k = `${r.propertyId}:${ratingBand(r.rating)}`;
  if (!buckets.has(k)) buckets.set(k, []);
  buckets.get(k).push(r);
}
const picked = [];
while (picked.length < Math.min(count, all.length)) {
  let added = false;
  for (const list of buckets.values()) {
    if (list.length && picked.length < count) {
      picked.push(list.shift());
      added = true;
    }
  }
  if (!added) break;
}

mkdirSync("data/eval", { recursive: true });
writeFileSync(
  "data/eval/golden.todo.json",
  `${JSON.stringify(
    {
      instructions: `For each review add every topic it praises or complains about to "labels" as {"topic","polarity"}. Topics: ${topics.join(", ")}. Polarity: positive or negative. Leave labels empty if none apply. Set labelledBy, then save as data/eval/golden.json.`,
      labelledBy: "",
      properties: properties.map((p) => p.id),
      reviews: picked.map((r) => ({ id: r.id, propertyId: r.propertyId, rating: r.rating, title: r.title, liked: r.liked, disliked: r.disliked, labels: [] })),
    },
    null,
    1,
  )}\n`,
);
console.log(`Wrote ${picked.length} reviews to data/eval/golden.todo.json for labelling.`);
