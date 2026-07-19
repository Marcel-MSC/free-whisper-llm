import * as crypto from "crypto";

export const LICENSE_PREFIX = "VA-PRO-";

export function licenseSigningSecret(): string {
  return process.env.VOICE_AGENT_LICENSE_SECRET || "voice-agent-dev-license-secret-change-me";
}

export function signPayload(payloadB64: string): string {
  return crypto
    .createHmac("sha256", licenseSigningSecret())
    .update(payloadB64)
    .digest("hex");
}

export function mintLicenseKey(email: string, exp?: string): string {
  const payload = JSON.stringify({ email, exp });
  const payloadB64 = Buffer.from(payload, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${LICENSE_PREFIX}${payloadB64}.${signPayload(payloadB64)}`;
}

export function validateLicenseKey(key: string): {
  ok: boolean;
  email?: string;
  expiresAt?: string;
  reason?: string;
} {
  const trimmed = key.trim();
  if (!trimmed) {
    return { ok: false, reason: "Empty license key" };
  }

  if (trimmed === "DEV-PRO" && process.env.VOICE_AGENT_DEV_PRO === "1") {
    return { ok: true, email: "dev@localhost" };
  }

  if (!trimmed.startsWith(LICENSE_PREFIX)) {
    return { ok: false, reason: "Unrecognized license format" };
  }

  const body = trimmed.slice(LICENSE_PREFIX.length);
  const dot = body.lastIndexOf(".");
  if (dot <= 0) {
    return { ok: false, reason: "Malformed license key" };
  }
  const payloadB64 = body.slice(0, dot);
  const sig = body.slice(dot + 1);
  const expected = signPayload(payloadB64);
  if (!timingSafeEqualHex(sig, expected)) {
    return { ok: false, reason: "Invalid license signature" };
  }

  try {
    const json = Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8"
    );
    const data = JSON.parse(json) as { email?: string; exp?: string };
    if (data.exp) {
      const expMs = Date.parse(data.exp);
      if (!Number.isNaN(expMs) && expMs < Date.now()) {
        return { ok: false, reason: "License expired" };
      }
    }
    return {
      ok: true,
      email: typeof data.email === "string" ? data.email : undefined,
      expiresAt: typeof data.exp === "string" ? data.exp : undefined,
    };
  } catch {
    return { ok: false, reason: "Invalid license payload" };
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) {
      return false;
    }
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
