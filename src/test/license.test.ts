import * as assert from "assert";
import { mintLicenseKey, validateLicenseKey } from "../license/key";

const key = mintLicenseKey("user@example.com");
const ok = validateLicenseKey(key);
assert.strictEqual(ok.ok, true);
assert.strictEqual(ok.email, "user@example.com");

const bad = validateLicenseKey(key.slice(0, -2) + "ff");
assert.strictEqual(bad.ok, false);

const expired = mintLicenseKey("old@example.com", "2000-01-01T00:00:00.000Z");
assert.strictEqual(validateLicenseKey(expired).ok, false);

const prev = process.env.VOICE_AGENT_DEV_PRO;
process.env.VOICE_AGENT_DEV_PRO = "1";
assert.strictEqual(validateLicenseKey("DEV-PRO").ok, true);
if (prev === undefined) {
  delete process.env.VOICE_AGENT_DEV_PRO;
} else {
  process.env.VOICE_AGENT_DEV_PRO = prev;
}

console.log("license tests passed");
