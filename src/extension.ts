import * as vscode from "vscode";
import { VoiceAgentPanel } from "./ui/panel";
import { ensureWhisperReady, setupWhisper, WhisperError } from "./stt/whisper";
import { stopWhisperSidecar } from "./stt/whisperSidecar";
import { initSecrets, setApiKey, clearApiKey, hasApiKey } from "./secrets";
import {
  initEntitlements,
  activateLicense,
  deactivateLicense,
  getEntitlement,
  checkoutUrl,
  customerPortalUrl,
} from "./license/entitlements";
import { initHistory, clearHistory, configureHistory } from "./history";
import { ensurePrivacyConsent, resetPrivacyConsent, getPrivacyDisclosure } from "./privacy";
import { showHealthCheck } from "./health";
import { track, summarizeAnalytics } from "./analytics";
import { getConfig } from "./config";

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  initSecrets(context.secrets);
  initEntitlements(context.secrets, context.globalState);
  initHistory(context.globalState);
  configureHistory({
    maxEntries: () => getConfig().historyMaxEntries,
    recordDrafts: () => getConfig().historyRecordDrafts,
  });

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "voiceAgent.talk";
  setRecordingState(false);
  statusBarItem.show();

  const setRec = (recording: boolean) => setRecordingState(recording);

  context.subscriptions.push(
    statusBarItem,
    vscode.commands.registerCommand("voiceAgent.openPanel", () => {
      VoiceAgentPanel.show(context, setRec);
    }),
    vscode.commands.registerCommand("voiceAgent.talk", async () => {
      const panel = VoiceAgentPanel.show(context, setRec);
      if (panel.isRecording()) {
        await panel.stopRecording();
      } else {
        await panel.startRecording();
      }
    }),
    vscode.commands.registerCommand("voiceAgent.stop", async () => {
      const panel = VoiceAgentPanel.show(context, setRec);
      if (panel.isRecording()) {
        await panel.stopRecording();
      }
    }),
    vscode.commands.registerCommand("voiceAgent.setupWhisper", async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Voice Agent: setting up Whisper…",
          cancellable: false,
        },
        async () => {
          try {
            const msg = await setupWhisper(context.extensionPath);
            await track("setup_success");
            void vscode.window.showInformationMessage(msg);
          } catch (err) {
            await track("setup_failure");
            const message =
              err instanceof WhisperError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : String(err);
            void vscode.window.showErrorMessage(`Whisper setup failed: ${message}`);
          }
        }
      );
    }),
    vscode.commands.registerCommand("voiceAgent.setApiKey", async () => {
      const key = await vscode.window.showInputBox({
        title: "Voice Agent API Key",
        prompt: "Stored in VS Code Secret Storage (not settings sync)",
        password: true,
        ignoreFocusOut: true,
      });
      if (key === undefined) {
        return;
      }
      await setApiKey(key);
      void vscode.window.showInformationMessage(
        key.trim()
          ? "API key saved to Secret Storage."
          : "API key cleared."
      );
    }),
    vscode.commands.registerCommand("voiceAgent.clearApiKey", async () => {
      await clearApiKey();
      void vscode.window.showInformationMessage("API key cleared from Secret Storage.");
    }),
    vscode.commands.registerCommand("voiceAgent.healthCheck", async () => {
      await showHealthCheck(context.extensionPath);
    }),
    vscode.commands.registerCommand("voiceAgent.showPrivacy", async () => {
      const d = getPrivacyDisclosure();
      const doc = await vscode.workspace.openTextDocument({
        content: [`# Privacy — ${d.provider}`, "", d.summary, "", ...d.details.map((x) => `- ${x}`)].join("\n"),
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand("voiceAgent.resetPrivacyConsent", async () => {
      await resetPrivacyConsent(context);
      void vscode.window.showInformationMessage(
        "Privacy consent reset. You will be asked again before the next agent run."
      );
    }),
    vscode.commands.registerCommand("voiceAgent.activateLicense", async () => {
      const key = await vscode.window.showInputBox({
        title: "Activate Voice Agent Pro",
        prompt: "Paste your VA-PRO-… license key",
        ignoreFocusOut: true,
      });
      if (!key) {
        return;
      }
      try {
        const ent = await activateLicense(key);
        await track("license_activate");
        void vscode.window.showInformationMessage(
          `Pro activated${ent.email ? ` for ${ent.email}` : ""}.`
        );
      } catch (err) {
        void vscode.window.showErrorMessage(
          `License activation failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }),
    vscode.commands.registerCommand("voiceAgent.deactivateLicense", async () => {
      await deactivateLicense();
      await track("license_deactivate");
      void vscode.window.showInformationMessage("Pro license removed. Back to Free tier.");
    }),
    vscode.commands.registerCommand("voiceAgent.manageSubscription", async () => {
      await track("purchase_click");
      const ent = await getEntitlement();
      const url = ent.tier === "pro" ? customerPortalUrl() : checkoutUrl();
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),
    vscode.commands.registerCommand("voiceAgent.showPlan", async () => {
      const ent = await getEntitlement();
      const keyed = await hasApiKey();
      const lines = [
        `# Voice Agent plan: ${ent.tier}`,
        "",
        ent.email ? `- Account: ${ent.email}` : "- Account: (none)",
        ent.expiresAt ? `- Expires: ${ent.expiresAt}` : "",
        `- Source: ${ent.source}`,
        `- Features: ${ent.features.length ? ent.features.join(", ") : "(free core only)"}`,
        `- API key in Secret Storage: ${keyed ? "yes" : "no"}`,
        "",
        "## Free",
        "- Local Whisper STT",
        "- BYOK / Ollama plan · ask · single-file edit · shell (with confirmations)",
        "",
        "## Pro",
        "- Workspace search / multi-file context",
        "- Multi-file patch workflow",
        "- Session history",
        "- Warm Whisper sidecar",
        "- Health checks polish",
      ].filter(Boolean);
      const doc = await vscode.workspace.openTextDocument({
        content: lines.join("\n"),
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand("voiceAgent.clearHistory", async () => {
      await clearHistory();
      VoiceAgentPanel.notifyHistoryCleared();
      void vscode.window.showInformationMessage("Transcript history cleared.");
    }),
    vscode.commands.registerCommand("voiceAgent.showAnalytics", async () => {
      const summary = await summarizeAnalytics();
      const doc = await vscode.workspace.openTextDocument({
        content: `# Voice Agent analytics (local)\n\n${summary}\n`,
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    })
  );

  // Soft check on activate — do not block startup
  void ensureWhisperReady(context.extensionPath).then(
    () => undefined,
    () => {
      statusBarItem.tooltip =
        "Voice Agent (Whisper not ready — run Voice Agent: Setup Whisper)";
    }
  );

  // First-run privacy nudge (non-blocking)
  void ensurePrivacyConsent(context);
}

export async function deactivate(): Promise<void> {
  await stopWhisperSidecar();
}

function setRecordingState(recording: boolean): void {
  void vscode.commands.executeCommand("setContext", "voiceAgent.recording", recording);
  if (recording) {
    statusBarItem.text = "$(debug-stop) Voice Agent";
    statusBarItem.tooltip = "Stop recording";
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
    statusBarItem.command = "voiceAgent.stop";
  } else {
    statusBarItem.text = "$(mic) Voice Agent";
    statusBarItem.tooltip = "Start voice agent";
    statusBarItem.backgroundColor = undefined;
    statusBarItem.command = "voiceAgent.talk";
  }
}
