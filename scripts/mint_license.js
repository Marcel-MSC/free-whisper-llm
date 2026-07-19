#!/usr/bin/env node
/**
 * Mint a VA-PRO license key for soft-launch / pilot users.
 * Usage: node scripts/mint_license.js user@example.com [ISO-expiry]
 */
const crypto = require("crypto");

const email = process.argv[2];
const exp = process.argv[3];
if (!email) {
  console.error("Usage: node scripts/mint_license.js email [ISO-expiry]");
  process.exit(1);
}

const secret =
  process.env.VOICE_AGENT_LICENSE_SECRET ||
  "voice-agent-dev-license-secret-change-me";
const payload = JSON.stringify({ email, exp });
const payloadB64 = Buffer.from(payload, "utf8")
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "");
const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest("hex");
console.log(`VA-PRO-${payloadB64}.${sig}`);
