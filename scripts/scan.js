/**
 * scan: look for key-like strings in tracked files before pushing a public repo.
 * Exits non-zero when something suspicious is found. Values are never printed.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const patterns = [
  ["JWT (Supabase key)", /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
  ["Apify token", /apify_api_[A-Za-z0-9]{20,}/],
  ["Groq key", /gsk_[A-Za-z0-9]{20,}/],
  ["OpenRouter key", /sk-or-[A-Za-z0-9-]{20,}/],
  ["Generic secret key", /sk-[A-Za-z0-9]{32,}/],
  ["Vercel token", /\bvercel_[A-Za-z0-9]{20,}/i],
  ["Private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Assigned secret", /(?:KEY|TOKEN|SECRET|PASSWORD)\s*=\s*["']?[A-Za-z0-9_\-.]{16,}/],
];

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !f.endsWith("package-lock.json"));

let findings = 0;
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  text.split("\n").forEach((line, index) => {
    for (const [name, pattern] of patterns) {
      if (pattern.test(line)) {
        findings += 1;
        console.log(`${file}:${index + 1}  possible ${name}`);
      }
    }
  });
}

if (findings) {
  console.error(`\n${findings} possible secret(s) found. Review before pushing.`);
  process.exit(1);
}
console.log(`Scanned ${files.length} files: no key-like strings found.`);
