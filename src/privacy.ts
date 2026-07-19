import * as vscode from "vscode";
import { getConfig } from "./config";

const CONSENT_KEY = "voiceAgent.privacyConsent.v1";

export interface PrivacyDisclosure {
  provider: string;
  leavesMachine: boolean;
  summary: string;
  details: string[];
}

export function getPrivacyDisclosure(): PrivacyDisclosure {
  const config = getConfig();
  switch (config.llmProvider) {
    case "ollama":
      return {
        provider: "ollama",
        leavesMachine: !isLocalUrl(config.llmBaseUrl),
        summary: isLocalUrl(config.llmBaseUrl)
          ? "Ollama is configured for a local URL. Transcript and editor context stay on this machine unless your Ollama server is remote."
          : "Ollama base URL looks remote. Transcript and editor/workspace context will be sent to that host.",
        details: [
          "Audio is transcribed locally with Whisper and is not uploaded.",
          "The transcript, active file excerpt/selection, workspace paths, and (with Pro) searched file snippets are sent to the LLM.",
          `Current endpoint: ${config.llmBaseUrl}`,
        ],
      };
    case "openai":
      return {
        provider: "openai",
        leavesMachine: true,
        summary:
          "OpenAI (or OpenAI-compatible) providers receive your transcript and editor/workspace context over the network.",
        details: [
          "Audio stays local (Whisper on this machine).",
          "Transcript text, active file contents/selection, paths, and optional search snippets leave the machine.",
          "API keys are stored in VS Code Secret Storage, not in settings sync.",
          `Model: ${config.llmModel}`,
        ],
      };
    case "anthropic":
      return {
        provider: "anthropic",
        leavesMachine: true,
        summary:
          "Anthropic receives your transcript and editor/workspace context over the network.",
        details: [
          "Audio stays local (Whisper on this machine).",
          "Transcript text, active file contents/selection, paths, and optional search snippets leave the machine.",
          "API keys are stored in VS Code Secret Storage, not in settings sync.",
          `Model: ${config.llmModel}`,
        ],
      };
  }
}

function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === "127.0.0.1" ||
      u.hostname === "localhost" ||
      u.hostname === "::1"
    );
  } catch {
    return false;
  }
}

export async function ensurePrivacyConsent(
  context: vscode.ExtensionContext
): Promise<boolean> {
  if (context.globalState.get<boolean>(CONSENT_KEY)) {
    return true;
  }

  const disclosure = getPrivacyDisclosure();
  const detail = [
    disclosure.summary,
    "",
    ...disclosure.details.map((d) => `• ${d}`),
    "",
    "You can change the LLM provider anytime in Settings → Voice Agent.",
  ].join("\n");

  const choice = await vscode.window.showInformationMessage(
    "Voice Agent privacy notice",
    { modal: true, detail },
    "I understand",
    "Cancel"
  );

  if (choice !== "I understand") {
    return false;
  }

  await context.globalState.update(CONSENT_KEY, true);
  return true;
}

export async function resetPrivacyConsent(
  context: vscode.ExtensionContext
): Promise<void> {
  await context.globalState.update(CONSENT_KEY, undefined);
}
