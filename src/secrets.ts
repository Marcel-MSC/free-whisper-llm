import * as vscode from "vscode";

const API_KEY_SECRET = "voiceAgent.llm.apiKey";

let secrets: vscode.SecretStorage | undefined;

export function initSecrets(storage: vscode.SecretStorage): void {
  secrets = storage;
}

export async function getApiKey(): Promise<string> {
  if (!secrets) {
    return "";
  }
  const stored = await secrets.get(API_KEY_SECRET);
  if (stored) {
    return stored;
  }

  // One-time migration from insecure settings (then clear settings value).
  const cfg = vscode.workspace.getConfiguration("voiceAgent");
  const legacy = cfg.get<string>("llm.apiKey", "")?.trim() ?? "";
  if (legacy) {
    await secrets.store(API_KEY_SECRET, legacy);
    try {
      await cfg.update("llm.apiKey", "", vscode.ConfigurationTarget.Global);
    } catch {
      // Settings may be read-only in some hosts; ignore.
    }
    return legacy;
  }
  return "";
}

export async function setApiKey(key: string): Promise<void> {
  if (!secrets) {
    throw new Error("Secret storage is not initialized.");
  }
  const trimmed = key.trim();
  if (!trimmed) {
    await secrets.delete(API_KEY_SECRET);
    return;
  }
  await secrets.store(API_KEY_SECRET, trimmed);
}

export async function clearApiKey(): Promise<void> {
  await setApiKey("");
}

export async function hasApiKey(): Promise<boolean> {
  const key = await getApiKey();
  return key.length > 0;
}
