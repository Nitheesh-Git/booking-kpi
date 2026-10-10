import { basename } from "node:path";
import { createDatabaseClient } from "../lib/db.js";
import { loadEnvironment } from "../lib/env.js";
import { readImportFile } from "../lib/import.js";
import { ingestPreparedReviews, prepareReviews } from "../lib/ingest.js";

const args = process.argv.slice(2);
const filePath = args[0];
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const propertyId = flag("--property");
const ratingScale = Number(flag("--scale") ?? 10);
if (!filePath || !propertyId || ![5, 10].includes(ratingScale)) {
  throw new Error(
    "Usage: npm run import -- <file.csv|file.json> --property <slug> [--scale 10|5]",
  );
}

const database = createDatabaseClient(loadEnvironment());
const { data: run, error: runError } = await database
  .from("scrape_runs")
  .insert({ trigger: "import", status: "running" })
  .select("id")
  .single();
if (runError) throw runError;
try {
  const items = readImportFile(filePath);
  const prepared = prepareReviews(items, propertyId, new Date(), { ratingScale });
  const counts = await ingestPreparedReviews(database, run.id, prepared);
  if (prepared.rejected.length) {
    const { error } = await database
      .from("rejected_items")
      .insert(
        prepared.rejected
          .slice(0, 20)
          .map((item) => ({ ...item, run_id: run.id })),
      );
    if (error) throw error;
  }
  const { error } = await database
    .from("scrape_runs")
    .update({
      status: "ingested",
      finished_at: new Date().toISOString(),
      items_fetched: items.length,
      ...counts,
    })
    .eq("id", run.id);
  if (error) throw error;
  console.log(
    `Imported ${basename(filePath)}: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged, ${counts.rejected} rejected.`,
  );
} catch (error) {
  await database
    .from("scrape_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unknown import error",
    })
    .eq("id", run.id);
  throw error;
}
