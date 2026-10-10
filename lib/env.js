import { existsSync, readFileSync } from "node:fs";

export function loadEnvironment() {
  if (!existsSync(".env")) return process.env;
  const values = { ...process.env };
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) continue;
    const index = line.indexOf("=");
    values[line.slice(0, index)] = line.slice(index + 1).trim();
  }
  return values;
}
