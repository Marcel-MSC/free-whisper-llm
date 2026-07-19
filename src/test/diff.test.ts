import * as assert from "assert";
import { unifiedDiff, formatDiffPreview } from "../agent/diff";

const d = unifiedDiff("a.ts", "hello\nworld\n", "hello\nthere\n");
assert.ok(d.unified.includes("-world"));
assert.ok(d.unified.includes("+there"));
assert.ok(d.added >= 1);
assert.ok(d.removed >= 1);

const neu = unifiedDiff("new.ts", "", "line1\n");
assert.strictEqual(neu.isNew, true);

const preview = formatDiffPreview([d], 200);
assert.ok(preview.includes("a.ts"));

console.log("diff tests passed");
