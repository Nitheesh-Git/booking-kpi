import { ingestActorRun } from "../lib/collect.js";
import { createDatabaseClient } from "../lib/db.js";
import { loadEnvironment } from "../lib/env.js";

const apifyRunId = process.argv[2];
if (!apifyRunId) throw new Error("Usage: npm run ingest-run -- <apifyRunId>");
const environment = loadEnvironment();
const database = createDatabaseClient(environment);
const { data: run, error } = await database
  .from("scrape_runs")
  .select("id")
  .eq("apify_run_id", apifyRunId)
  .single();
if (error) throw error;
console.log(await ingestActorRun(database, environment, run.id, apifyRunId));
