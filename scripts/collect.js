import { startCollection, ingestActorRun } from "../lib/collect.js";
import { createDatabaseClient } from "../lib/db.js";
import { loadEnvironment } from "../lib/env.js";

const database = createDatabaseClient(loadEnvironment());
const runs = await startCollection(database, loadEnvironment());
for (const run of runs) {
  if (run.error) {
    console.error(`${run.propertyId}: ${run.error}`);
    continue;
  }
  let result;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    result = await ingestActorRun(
      database,
      loadEnvironment(),
      run.localRunId,
      run.apifyRunId,
      run.propertyId,
    );
    if (result.complete) break;
  }
  console.log(
    `${run.propertyId}: ${result?.complete ? JSON.stringify(result.counts) : "still running, use ingest-run later"}`,
  );
}
