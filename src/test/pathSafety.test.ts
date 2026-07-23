import * as assert from "assert";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { isPathInsideRoots, resolveUnderRoots, canonicalizePath } from "../agent/pathSafety";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "va-path-"));
const inside = path.join(root, "src", "file.ts");
fs.mkdirSync(path.dirname(inside), { recursive: true });
fs.writeFileSync(inside, "x");

assert.strictEqual(isPathInsideRoots(inside, [root]), true);
assert.strictEqual(isPathInsideRoots(path.join(root, "..", "outside"), [root]), false);

const resolved = resolveUnderRoots("src/file.ts", [root]);
assert.strictEqual(canonicalizePath(resolved), canonicalizePath(inside));

let threw = false;
try {
  resolveUnderRoots("x", []);
} catch {
  threw = true;
}
assert.strictEqual(threw, true);

const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "va-path-b-"));
const preferredInside = path.join(rootB, "src", "file.ts");
fs.mkdirSync(path.dirname(preferredInside), { recursive: true });
fs.writeFileSync(preferredInside, "y");

const preferredResolved = resolveUnderRoots("src/file.ts", [root, rootB], rootB);
assert.strictEqual(
  canonicalizePath(preferredResolved),
  canonicalizePath(preferredInside)
);

const defaultResolved = resolveUnderRoots("src/file.ts", [root, rootB]);
assert.strictEqual(canonicalizePath(defaultResolved), canonicalizePath(inside));

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(rootB, { recursive: true, force: true });
console.log("pathSafety tests passed");
