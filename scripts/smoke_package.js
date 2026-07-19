#!/usr/bin/env node
/**
 * Packaging smoke check: ensure a .vsix exists and contains critical files.
 * Uses Python's zipfile (no unzip binary required).
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const vsix = fs
  .readdirSync(root)
  .filter((f) => f.endsWith(".vsix"))
  .sort()
  .pop();

if (!vsix) {
  console.error("No .vsix found. Run npm run package first.");
  process.exit(1);
}

const full = path.join(root, vsix);
const listing = execFileSync(
  "python3",
  [
    "-c",
    "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print('\\n'.join(z.namelist()))",
    full,
  ],
  { encoding: "utf8" }
);

const required = [
  "extension/package.json",
  "extension/out/extension.js",
  "extension/scripts/whisper_transcribe.py",
  "extension/media/webview/main.js",
  "extension/media/webview/styles.css",
  "extension/PRIVACY.md",
  "extension/CHANGELOG.md",
];

// vsce may normalize some filenames (e.g. CHANGELOG.md -> changelog.md).
const lowerListing = listing.toLowerCase();

let ok = true;
for (const r of required) {
  if (!lowerListing.includes(r.toLowerCase())) {
    console.error(`Missing in VSIX: ${r}`);
    ok = false;
  }
}

if (lowerListing.includes("extension/out/test/")) {
  console.error("VSIX should not include out/test/");
  ok = false;
}

if (!ok) {
  process.exit(1);
}
console.log(`smoke:package ok — ${vsix}`);
