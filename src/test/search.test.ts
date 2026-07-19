import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  redactSecrets,
  searchWorkspace,
  extractSearchTerms,
  shouldSkipDir,
} from "../agent/search";

assert.ok(redactSecrets('api_key="sk-abc12345678901234567890"').includes("[REDACTED]"));
assert.ok(shouldSkipDir("node_modules"));
assert.ok(!shouldSkipDir("src"));

const terms = extractSearchTerms("please update VoiceAgentPanel handleEdit");
assert.ok(terms.some((t) => /VoiceAgentPanel|handleEdit/i.test(t)));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "va-search-"));
fs.writeFileSync(path.join(root, "hello.ts"), "export const VoiceAgentPanel = 1;\n");
fs.mkdirSync(path.join(root, "node_modules"));
fs.writeFileSync(path.join(root, "node_modules", "skip.ts"), "VoiceAgentPanel\n");

const hits = searchWorkspace([root], "VoiceAgentPanel", { maxHits: 5 });
assert.ok(hits.length >= 1);
assert.ok(hits.every((h) => !h.path.includes("node_modules")));

fs.rmSync(root, { recursive: true, force: true });
console.log("search tests passed");
