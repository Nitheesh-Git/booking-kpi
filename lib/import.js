import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

export function readImportFile(filePath) {
  const source = readFileSync(filePath, "utf8");
  if (filePath.toLowerCase().endsWith(".csv"))
    return parse(source, { columns: true, skip_empty_lines: true, trim: true });
  const parsed = JSON.parse(source);
  if (!Array.isArray(parsed))
    throw new Error("JSON imports must contain an array of review rows");
  return parsed;
}
