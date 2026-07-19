import * as vscode from "vscode";
import * as fs from "fs";
import { getConfig } from "./config";
import { ensureWhisperReady, resolvePythonPath, resolveScriptPath } from "./stt/whisper";
import { getApiKey, hasApiKey } from "./secrets";
import { probeNativeCapture } from "./audio/nativeCapture";
import { getEntitlement } from "./license/entitlements";
import { testProviderConnection } from "./llm/provider";
import { getPrivacyDisclosure } from "./privacy";

export interface HealthReport {
  ok: boolean;
  lines: string[];
}

export async function runHealthCheck(
  extensionPath: string
): Promise<HealthReport> {
  const lines: string[] = [];
  let ok = true;
  const config = getConfig();

  const python = resolvePythonPath(extensionPath);
  const script = resolveScriptPath(extensionPath);
  lines.push(`Python: ${python}`);
  lines.push(`Script: ${script}`);
  if (!fs.existsSync(script)) {
    ok = false;
    lines.push("✗ Whisper script missing");
  } else {
    lines.push("✓ Whisper script present");
  }

  try {
    await ensureWhisperReady(extensionPath);
    lines.push("✓ Whisper import check passed");
  } catch (err) {
    ok = false;
    lines.push(
      `✗ Whisper not ready: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  lines.push(`LLM provider: ${config.llmProvider} / ${config.llmModel}`);
  lines.push(`LLM base URL: ${config.llmBaseUrl}`);
  if (config.llmProvider === "ollama") {
    try {
      const msg = await testProviderConnection();
      lines.push(`✓ Provider: ${msg}`);
    } catch (err) {
      ok = false;
      lines.push(
        `✗ Provider: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    const keyed = await hasApiKey();
    if (!keyed) {
      ok = false;
      lines.push("✗ API key missing (Voice Agent: Set API Key)");
    } else {
      lines.push("✓ API key present in Secret Storage");
      try {
        const msg = await testProviderConnection();
        lines.push(`✓ Provider: ${msg}`);
      } catch (err) {
        ok = false;
        lines.push(
          `✗ Provider: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  const native = await probeNativeCapture();
  lines.push(
    native.available
      ? `✓ Native capture: ${native.backend}`
      : `• Native capture unavailable: ${native.detail}`
  );

  const ent = await getEntitlement();
  lines.push(`Plan: ${ent.tier}${ent.email ? ` (${ent.email})` : ""}`);

  const privacy = getPrivacyDisclosure();
  lines.push(
    privacy.leavesMachine
      ? `⚠ Context leaves machine via ${privacy.provider}`
      : `✓ Local LLM endpoint (${privacy.provider})`
  );

  // Touch getApiKey so migration path runs during health.
  await getApiKey();

  return { ok, lines };
}

export async function showHealthCheck(extensionPath: string): Promise<void> {
  const report = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Voice Agent: health check…",
      cancellable: false,
    },
    () => runHealthCheck(extensionPath)
  );

  const doc = await vscode.workspace.openTextDocument({
    content: report.lines.join("\n"),
    language: "markdown",
  });
  await vscode.window.showTextDocument(doc, { preview: true });
  if (report.ok) {
    void vscode.window.showInformationMessage("Voice Agent health check passed.");
  } else {
    void vscode.window.showWarningMessage(
      "Voice Agent health check found issues. See the report."
    );
  }
}
