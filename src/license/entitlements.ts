import * as vscode from "vscode";
import { mintLicenseKey, validateLicenseKey } from "./key";

const LICENSE_SECRET_KEY = "voiceAgent.license.key";
const ENTITLEMENT_CACHE_KEY = "voiceAgent.entitlement.cache.v1";

export type PlanTier = "free" | "pro";

export interface Entitlement {
  tier: PlanTier;
  licenseKey?: string;
  email?: string;
  expiresAt?: string;
  features: ProFeature[];
  source: "none" | "license" | "offline-cache" | "dev";
}

export type ProFeature =
  | "codebaseSearch"
  | "multiFilePatches"
  | "sessionHistory"
  | "warmWhisper"
  | "healthChecks";

const PRO_FEATURES: ProFeature[] = [
  "codebaseSearch",
  "multiFilePatches",
  "sessionHistory",
  "warmWhisper",
  "healthChecks",
];

let secrets: vscode.SecretStorage | undefined;
let globalState: vscode.Memento | undefined;
let cached: Entitlement | undefined;

export function initEntitlements(
  storage: vscode.SecretStorage,
  state: vscode.Memento
): void {
  secrets = storage;
  globalState = state;
  cached = undefined;
}

export function freeEntitlement(): Entitlement {
  return {
    tier: "free",
    features: [],
    source: "none",
  };
}

export function proEntitlement(
  licenseKey: string,
  source: Entitlement["source"] = "license",
  email?: string,
  expiresAt?: string
): Entitlement {
  return {
    tier: "pro",
    licenseKey,
    email,
    expiresAt,
    features: [...PRO_FEATURES],
    source,
  };
}

export { mintLicenseKey, validateLicenseKey };

export async function getEntitlement(): Promise<Entitlement> {
  if (cached) {
    return cached;
  }

  if (process.env.VOICE_AGENT_DEV_PRO === "1") {
    cached = proEntitlement("DEV-PRO", "dev", "dev@localhost");
    return cached;
  }

  const key = secrets ? await secrets.get(LICENSE_SECRET_KEY) : undefined;
  if (key) {
    const result = validateLicenseKey(key);
    if (result.ok) {
      cached = proEntitlement(key, "license", result.email, result.expiresAt);
      await persistCache(cached);
      return cached;
    }
  }

  const offline = globalState?.get<Entitlement>(ENTITLEMENT_CACHE_KEY);
  if (offline?.tier === "pro" && offline.expiresAt) {
    const exp = Date.parse(offline.expiresAt);
    if (!Number.isNaN(exp) && exp > Date.now()) {
      cached = { ...offline, source: "offline-cache" };
      return cached;
    }
  }

  cached = freeEntitlement();
  return cached;
}

async function persistCache(ent: Entitlement): Promise<void> {
  if (!globalState) {
    return;
  }
  const graceDays = 7;
  const cacheExpiry = new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000).toISOString();
  await globalState.update(ENTITLEMENT_CACHE_KEY, {
    ...ent,
    expiresAt: ent.expiresAt || cacheExpiry,
  });
}

export async function activateLicense(key: string): Promise<Entitlement> {
  const result = validateLicenseKey(key);
  if (!result.ok) {
    throw new Error(result.reason || "Invalid license");
  }
  if (!secrets) {
    throw new Error("Secret storage is not initialized.");
  }
  await secrets.store(LICENSE_SECRET_KEY, key.trim());
  cached = proEntitlement(key.trim(), "license", result.email, result.expiresAt);
  await persistCache(cached);
  return cached;
}

export async function deactivateLicense(): Promise<void> {
  if (secrets) {
    await secrets.delete(LICENSE_SECRET_KEY);
  }
  if (globalState) {
    await globalState.update(ENTITLEMENT_CACHE_KEY, undefined);
  }
  cached = freeEntitlement();
}

export async function hasFeature(feature: ProFeature): Promise<boolean> {
  const ent = await getEntitlement();
  return ent.tier === "pro" && ent.features.includes(feature);
}

export function checkoutUrl(): string {
  const cfg = vscode.workspace.getConfiguration("voiceAgent");
  return (
    cfg.get<string>("billing.checkoutUrl", "") ||
    "https://example.com/voice-agent/checkout"
  );
}

export function customerPortalUrl(): string {
  const cfg = vscode.workspace.getConfiguration("voiceAgent");
  return (
    cfg.get<string>("billing.portalUrl", "") ||
    "https://example.com/voice-agent/portal"
  );
}
