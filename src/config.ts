import * as vscode from "vscode";

export type LlmProvider = "ollama" | "openai" | "anthropic";
export type WhisperLanguage = "pt" | "en" | "es" | "fr" | "de" | "auto";
export type AudioCaptureMode = "auto" | "webview" | "native";

export interface VoiceAgentConfig {
  whisperModel: string;
  whisperLanguage: WhisperLanguage;
  pythonPath: string;
  scriptPath: string;
  audioCaptureMode: AudioCaptureMode;
  llmProvider: LlmProvider;
  llmBaseUrl: string;
  llmModel: string;
  /** @deprecated Use Secret Storage via getApiKey(); kept for migration only. */
  llmApiKey: string;
  shellConfirm: boolean;
  editConfirmMultiFile: boolean;
  confidenceThreshold: number;
  llmTimeoutMs: number;
  llmRetries: number;
  warmWhisper: boolean;
  analyticsEnabled: boolean;
}

export function getConfig(): VoiceAgentConfig {
  const cfg = vscode.workspace.getConfiguration("voiceAgent");
  return {
    whisperModel: cfg.get<string>("whisper.model", "base"),
    whisperLanguage: cfg.get<WhisperLanguage>("whisper.language", "pt"),
    pythonPath: cfg.get<string>("whisper.pythonPath", "python3"),
    scriptPath: cfg.get<string>("whisper.scriptPath", ""),
    audioCaptureMode: cfg.get<AudioCaptureMode>("audio.captureMode", "auto"),
    llmProvider: cfg.get<LlmProvider>("llm.provider", "ollama"),
    llmBaseUrl: cfg.get<string>("llm.baseUrl", "http://127.0.0.1:11434"),
    llmModel: cfg.get<string>("llm.model", "llama3.2"),
    llmApiKey: cfg.get<string>("llm.apiKey", ""),
    shellConfirm: cfg.get<boolean>("shell.confirm", true),
    editConfirmMultiFile: cfg.get<boolean>("edit.confirmMultiFile", true),
    confidenceThreshold: cfg.get<number>("confidenceThreshold", 0.55),
    llmTimeoutMs: cfg.get<number>("llm.timeoutMs", 90_000),
    llmRetries: cfg.get<number>("llm.retries", 2),
    warmWhisper: cfg.get<boolean>("whisper.warmSidecar", true),
    analyticsEnabled: cfg.get<boolean>("analytics.enabled", true),
  };
}
