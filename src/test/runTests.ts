/**
 * Lightweight test runner — executes each *.test.js next to this file.
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const dir = __dirname;
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".test.js"))
  .sort();

let failed = 0;
for (const file of files) {
  const full = path.join(dir, file);
  const result = spawnSync(process.execPath, [full], {
    encoding: "utf8",
    env: process.env,
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.status !== 0) {
    failed++;
    console.error(`FAILED ${file}`);
  }
}

if (failed) {
  console.error(`\n${failed} test file(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${files.length} test file(s) passed`);
