import * as vscode from "vscode";

export type LlmProvider = "ollama" | "openai" | "anthropic";
export type WhisperLanguage = "pt" | "en" | "es" | "fr" | "de" | "auto";

export interface VoiceAgentConfig {
  whisperModel: string;
  whisperLanguage: WhisperLanguage;
  pythonPath: string;
  scriptPath: string;
  llmProvider: LlmProvider;
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
  shellConfirm: boolean;
  editConfirmMultiFile: boolean;
  confidenceThreshold: number;
}

export function getConfig(): VoiceAgentConfig {
  const cfg = vscode.workspace.getConfiguration("voiceAgent");
  return {
    whisperModel: cfg.get<string>("whisper.model", "base"),
    whisperLanguage: cfg.get<WhisperLanguage>("whisper.language", "pt"),
    pythonPath: cfg.get<string>("whisper.pythonPath", "python3"),
    scriptPath: cfg.get<string>("whisper.scriptPath", ""),
    llmProvider: cfg.get<LlmProvider>("llm.provider", "ollama"),
    llmBaseUrl: cfg.get<string>("llm.baseUrl", "http://127.0.0.1:11434"),
    llmModel: cfg.get<string>("llm.model", "llama3.2"),
    llmApiKey: cfg.get<string>("llm.apiKey", ""),
    shellConfirm: cfg.get<boolean>("shell.confirm", true),
    editConfirmMultiFile: cfg.get<boolean>("edit.confirmMultiFile", true),
    confidenceThreshold: cfg.get<number>("confidenceThreshold", 0.55),
  };
}
