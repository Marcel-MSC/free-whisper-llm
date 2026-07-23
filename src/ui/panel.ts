import * as vscode from "vscode";
import { runAgent } from "../agent/run";
import {
  transcribeWav,
  writeWavTemp,
  cleanupTemp,
  WhisperError,
} from "../stt/whisper";
import {
  cancelNativeCapture,
  defaultCaptureMode,
  isNativeCaptureActive,
  probeNativeCapture,
  startNativeCapture,
  stopNativeCapture,
  NativeCaptureError,
} from "../audio/nativeCapture";
import { getConfig, setWhisperLanguage, WHISPER_LANGUAGES, type WhisperLanguage } from "../config";
import { ensurePrivacyConsent } from "../privacy";
import {
  pushHistory,
  getHistoryPage,
  HISTORY_PAGE_SIZE,
  recordDraftsEnabled,
  historyDisplayTitle,
  type HistoryEntry,
  type HistoryKind,
} from "../history";
import { hasFeature, getEntitlement } from "../license/entitlements";
import { track } from "../analytics";
import { renderMarkdown } from "../markdown";
import { LlmError } from "../llm/provider";
import type { AgentProgressStep } from "../agent/run";

const SELECTED_WS_KEY = "voiceAgent.selectedWorkspace.v1";
const ALWAYS_APPROVE_KEY = "voiceAgent.alwaysApproveEdits.v1";

const PROGRESS_LABELS: Record<AgentProgressStep, string> = {
  gathering_context: "Gathering context…",
  routing: "Routing intent…",
  searching: "Searching workspace…",
  planning: "Planning…",
  asking: "Answering…",
  editing: "Preparing edits…",
  shell: "Preparing shell command…",
  awaiting_confirm: "Waiting for confirmation…",
  done: "Done",
};

export type PanelStatus =
  | "idle"
  | "recording"
  | "transcribing"
  | "review"
  | "routing"
  | "running"
  | "error"
  | "done";

interface PanelState {
  status: PanelStatus;
  transcript: string;
  intent: string;
  confidence: number;
  summary: string;
  result: string;
  resultHtml: string;
  error: string;
  plan: string;
  historyTotal: number;
  historyPro: boolean;
}

type PromptSource = "voice" | "typed";

type ActiveMode = "webview" | "native";

export class VoiceAgentPanel {
  public static readonly viewType = "voiceAgent.panel";
  private static current: VoiceAgentPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly extensionPath: string;
  private readonly context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];
  private recording = false;
  private activeMode: ActiveMode = "webview";
  private onRecordingChange?: (recording: boolean) => void;
  private abort?: AbortController;
  private firstSuccessTracked = false;
  /** How the current review transcript was produced (voice STT vs typed). */
  private promptSource: PromptSource = "typed";
  /** Text being run (for cancel/error history). */
  private pendingTranscript = "";
  private nativeAutoStopTimer?: ReturnType<typeof setTimeout>;
  private progressSteps: Array<{ step: AgentProgressStep; label: string }> = [];

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    onRecordingChange?: (recording: boolean) => void
  ) {
    this.panel = panel;
    this.context = context;
    this.extensionUri = context.extensionUri;
    this.extensionPath = context.extensionPath;
    this.onRecordingChange = onRecordingChange;

    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => void this.onMessage(msg),
      null,
      this.disposables
    );
  }

  public static show(
    context: vscode.ExtensionContext,
    onRecordingChange?: (recording: boolean) => void
  ): VoiceAgentPanel {
    if (VoiceAgentPanel.current) {
      VoiceAgentPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      VoiceAgentPanel.current.onRecordingChange = onRecordingChange;
      return VoiceAgentPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      VoiceAgentPanel.viewType,
      "Voice Agent",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "media"),
        ],
      }
    );

    VoiceAgentPanel.current = new VoiceAgentPanel(
      panel,
      context,
      onRecordingChange
    );
    return VoiceAgentPanel.current;
  }

  /** Notify open panel that history was cleared (command palette). */
  public static notifyHistoryCleared(): void {
    VoiceAgentPanel.current?.post({
      type: "historyPage",
      offset: 0,
      limit: HISTORY_PAGE_SIZE,
      total: 0,
      hasMore: false,
      items: [],
      reset: true,
    });
  }

  public async startRecording(): Promise<void> {
    const consented = await ensurePrivacyConsent(this.context);
    if (!consented) {
      return;
    }

    const config = getConfig();
    const preferred = defaultCaptureMode(config.audioCaptureMode);
    const native = await probeNativeCapture();

    if (preferred === "native" && native.available) {
      await this.startNative();
      return;
    }

    this.activeMode = "webview";
    this.recording = true;
    this.onRecordingChange?.(true);
    const autoStopMs = config.audioAutoStopMs;
    this.post({ type: "startRecording", autoStopMs });
    await this.updateState({
      status: "recording",
      transcript: "",
      intent: "",
      confidence: 0,
      summary: `Listening… auto-stops in ${Math.round(autoStopMs / 1000)}s`,
      result: "",
      resultHtml: "",
      error: "",
    });
  }

  public async stopRecording(): Promise<void> {
    this.clearNativeAutoStop();
    if (this.activeMode === "native" || isNativeCaptureActive()) {
      await this.stopNative();
      return;
    }
    this.post({ type: "stopRecording" });
  }

  public isRecording(): boolean {
    return this.recording;
  }

  public cancelRunning(): void {
    this.abort?.abort();
    this.abort = undefined;
  }

  private async startNative(): Promise<void> {
    try {
      const { backend } = await startNativeCapture();
      this.activeMode = "native";
      this.recording = true;
      this.onRecordingChange?.(true);
      const autoStopMs = getConfig().audioAutoStopMs;
      this.post({
        type: "nativeRecording",
        active: true,
        autoStopMs,
      });
      this.clearNativeAutoStop();
      this.nativeAutoStopTimer = setTimeout(() => {
        void this.stopRecording();
      }, autoStopMs);
      await this.updateState({
        status: "recording",
        transcript: "",
        intent: "",
        confidence: 0,
        summary: `Native mic (${backend}) — auto-stops in ${Math.round(autoStopMs / 1000)}s`,
        result: "",
        resultHtml: "",
        error: "",
      });
    } catch (err) {
      this.clearNativeAutoStop();
      const message =
        err instanceof NativeCaptureError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      this.recording = false;
      this.onRecordingChange?.(false);
      await this.updateState({
        status: "error",
        transcript: "",
        intent: "",
        confidence: 0,
        summary: "",
        result: "",
        resultHtml: "",
        error: message,
      });
      void vscode.window.showErrorMessage(`Voice Agent: ${message}`);
    }
  }

  private async stopNative(): Promise<void> {
    this.clearNativeAutoStop();
    try {
      this.post({ type: "nativeRecording", active: false });
      const wavPath = await stopNativeCapture();
      this.recording = false;
      this.onRecordingChange?.(false);
      await this.handleWavPath(wavPath);
    } catch (err) {
      this.recording = false;
      this.onRecordingChange?.(false);
      const message =
        err instanceof NativeCaptureError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      await this.updateState({
        status: "error",
        transcript: "",
        intent: "",
        confidence: 0,
        summary: "",
        result: "",
        resultHtml: "",
        error: message,
      });
      void vscode.window.showErrorMessage(`Voice Agent: ${message}`);
    }
  }

  private clearNativeAutoStop(): void {
    if (this.nativeAutoStopTimer) {
      clearTimeout(this.nativeAutoStopTimer);
      this.nativeAutoStopTimer = undefined;
    }
  }

  private async onMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== "object") {
      return;
    }
    const msg = message as Record<string, unknown>;

    switch (msg.type) {
      case "ready":
        this.post({ type: "ping" });
        await this.pushPlanBadge();
        await this.pushPanelSettings();
        break;
      case "recordingStarted":
        this.recording = true;
        this.onRecordingChange?.(true);
        break;
      case "recordingStopped":
        if (this.activeMode === "webview") {
          this.recording = false;
          this.onRecordingChange?.(false);
        }
        break;
      case "audio":
        if (typeof msg.base64Wav === "string") {
          await this.handleAudio(msg.base64Wav);
        }
        break;
      case "micFailed": {
        const reason =
          typeof msg.message === "string" ? msg.message : "Permission denied";
        const native = await probeNativeCapture();
        if (native.available) {
          void vscode.window.showInformationMessage(
            `Webview mic failed (${reason}). Using native capture (${native.backend}).`
          );
          await this.startNative();
        } else {
          this.recording = false;
          this.onRecordingChange?.(false);
          await this.updateState({
            status: "error",
            transcript: "",
            intent: "",
            confidence: 0,
            summary: "",
            result: "",
            resultHtml: "",
            error:
              `Microphone access failed: ${reason}\n\n` +
              `Native fallback unavailable: ${native.detail}\n` +
              `On WSL: sudo apt install pulseaudio-utils\n` +
              `Also allow Cursor mic in Windows Privacy settings.`,
          });
        }
        break;
      }
      case "error":
        this.recording = false;
        this.onRecordingChange?.(false);
        await this.updateState({
          status: "error",
          transcript: "",
          intent: "",
          confidence: 0,
          summary: "",
          result: "",
          resultHtml: "",
          error: typeof msg.message === "string" ? msg.message : "Unknown error",
        });
        break;
      case "toggle":
        if (this.recording) {
          await this.stopRecording();
        } else {
          await this.startRecording();
        }
        break;
      case "requestNative":
        await this.startNative();
        break;
      case "stopNative":
        await this.stopNative();
        break;
      case "sendTranscript":
        if (typeof msg.text === "string") {
          await this.runWithTranscript(msg.text);
        }
        break;
      case "discardTranscript": {
        const discarded =
          typeof msg.text === "string" ? msg.text.trim() : "";
        if (discarded && recordDraftsEnabled()) {
          await this.recordHistory({
            kind: "draft_discarded",
            transcript: discarded,
            summary: "Discarded draft",
          });
        }
        this.pendingTranscript = "";
        await this.updateState({
          status: "idle",
          transcript: "",
          intent: "",
          confidence: 0,
          summary: "",
          result: "",
          resultHtml: "",
          error: "",
        });
        break;
      }
      case "cancel":
        this.cancelRunning();
        await this.updateState({
          status: "idle",
          transcript: this.pendingTranscript,
          intent: "",
          confidence: 0,
          summary: "Cancelled.",
          result: "",
          resultHtml: "",
          error: "",
        });
        break;
      case "typePrompt":
        this.promptSource = "typed";
        await this.updateState({
          status: "review",
          transcript: typeof msg.text === "string" ? msg.text : "",
          intent: "",
          confidence: 0,
          summary: "Type your request, then Send (no recording required).",
          result: "",
          resultHtml: "",
          error: "",
        });
        break;
      case "loadHistory": {
        const offset =
          typeof msg.offset === "number" && Number.isFinite(msg.offset)
            ? msg.offset
            : 0;
        const limit =
          typeof msg.limit === "number" && Number.isFinite(msg.limit)
            ? msg.limit
            : HISTORY_PAGE_SIZE;
        await this.sendHistoryPage(offset, limit, !!msg.reset);
        break;
      }
      case "reuseHistory":
        if (typeof msg.text === "string" && msg.text.trim()) {
          this.promptSource = "typed";
          await this.updateState({
            status: "review",
            transcript: msg.text.trim(),
            intent: "",
            confidence: 0,
            summary: "Loaded from transcript history — edit if needed, then Send.",
            result: "",
            resultHtml: "",
            error: "",
          });
        }
        break;
      case "cycleLanguage":
        await this.cycleLanguage();
        break;
      case "setLanguage":
        if (typeof msg.language === "string") {
          await this.setLanguage(msg.language);
        }
        break;
      case "selectWorkspace":
        if (typeof msg.path === "string") {
          await this.setSelectedWorkspace(msg.path);
        }
        break;
      case "toggleAlwaysApprove":
        await this.toggleAlwaysApprove();
        break;
    }
  }

  private async handleAudio(base64Wav: string): Promise<void> {
    this.recording = false;
    this.onRecordingChange?.(false);

    let wavPath: string | undefined;
    try {
      await this.updateState({
        status: "transcribing",
        transcript: "",
        intent: "",
        confidence: 0,
        summary: "",
        result: "",
        resultHtml: "",
        error: "",
      });

      wavPath = await writeWavTemp(base64Wav);
      await this.transcribeAndRun(wavPath);
    } catch (err) {
      await track("transcribe_error");
      this.showErr(err);
    } finally {
      if (wavPath) {
        await cleanupTemp(wavPath);
      }
    }
  }

  private async handleWavPath(wavPath: string): Promise<void> {
    try {
      await this.updateState({
        status: "transcribing",
        transcript: "",
        intent: "",
        confidence: 0,
        summary: "",
        result: "",
        resultHtml: "",
        error: "",
      });
      await this.transcribeAndRun(wavPath);
    } catch (err) {
      await track("transcribe_error");
      this.showErr(err);
    } finally {
      await cleanupTemp(wavPath);
    }
  }

  private async transcribeAndRun(wavPath: string): Promise<void> {
    const start = Date.now();
    const { text } = await transcribeWav(this.extensionPath, wavPath);
    await track("transcribe_ok", { ms: Date.now() - start });

    this.promptSource = "voice";
    if (text.trim() && recordDraftsEnabled()) {
      await this.recordHistory({
        kind: "draft_transcribed",
        transcript: text.trim(),
        summary: "Voice transcript (review)",
      });
    }

    await this.updateState({
      status: "review",
      transcript: text,
      intent: "",
      confidence: 0,
      summary: "Review the transcript, edit if needed, then Send.",
      result: "",
      resultHtml: "",
      error: "",
    });
  }

  private async runWithTranscript(raw: string): Promise<void> {
    const text = raw.trim();
    if (!text) {
      await this.updateState({
        status: "error",
        transcript: "",
        intent: "",
        confidence: 0,
        summary: "",
        result: "",
        resultHtml: "",
        error: "Transcript is empty. Record again or type something before Send.",
      });
      return;
    }

    const consented = await ensurePrivacyConsent(this.context);
    if (!consented) {
      return;
    }

    if (this.promptSource === "typed" && recordDraftsEnabled()) {
      await this.recordHistory({
        kind: "draft_typed",
        transcript: text,
        summary: "Typed prompt",
      });
    }

    this.pendingTranscript = text;
    this.abort?.abort();
    this.abort = new AbortController();
    this.progressSteps = [];

    try {
      await this.updateState({
        status: "running",
        transcript: text,
        intent: "…",
        confidence: 0,
        summary: "Running agent… (Cancel to abort)",
        result: "",
        resultHtml: "",
        error: "",
      });
      this.postProgress();

      const selectedRoot =
        this.context.globalState.get<string>(SELECTED_WS_KEY) || undefined;
      const alwaysApprove =
        this.context.globalState.get<boolean>(ALWAYS_APPROVE_KEY) === true;

      const run = await runAgent(text, {
        signal: this.abort.signal,
        selectedWorkspaceRoot: selectedRoot,
        alwaysApproveEdits: alwaysApprove,
        onProgress: (step) => {
          this.progressSteps.push({
            step,
            label: PROGRESS_LABELS[step] || step,
          });
          this.postProgress();
        },
      });

      await this.recordHistory({
        kind: "run_success",
        transcript: run.transcript,
        intent: run.routed.intent,
        summary: run.routed.summary,
        resultPreview: run.resultMarkdown,
      });

      if (!this.firstSuccessTracked) {
        this.firstSuccessTracked = true;
        await track("first_success", { intent: run.routed.intent });
      }

      await this.updateState({
        status: "done",
        transcript: run.transcript,
        intent: run.routed.intent,
        confidence: run.routed.confidence,
        summary: run.routed.summary,
        result: run.resultMarkdown,
        resultHtml: renderMarkdown(run.resultMarkdown),
        error: "",
      });
    } catch (err) {
      if (err instanceof Error && /cancel|abort/i.test(err.message)) {
        await this.recordHistory({
          kind: "run_cancelled",
          transcript: text,
          summary: "Cancelled",
        });
        await this.updateState({
          status: "idle",
          transcript: text,
          intent: "",
          confidence: 0,
          summary: "Cancelled.",
          result: "",
          resultHtml: "",
          error: "",
        });
        return;
      }
      const message =
        err instanceof WhisperError ||
        err instanceof NativeCaptureError ||
        err instanceof LlmError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      await this.recordHistory({
        kind: "run_error",
        transcript: text,
        summary: "Run failed",
        error: message,
      });
      this.showErr(err, text);
    } finally {
      this.abort = undefined;
      this.pendingTranscript = "";
    }
  }

  private showErr(err: unknown, transcript = ""): void {
    const message =
      err instanceof WhisperError ||
      err instanceof NativeCaptureError ||
      err instanceof LlmError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    void this.updateState({
      status: "error",
      transcript,
      intent: "",
      confidence: 0,
      summary: "",
      result: "",
      resultHtml: "",
      error: message,
    });
    void vscode.window.showErrorMessage(`Voice Agent: ${message}`);
  }

  private async pushPlanBadge(): Promise<void> {
    const ent = await getEntitlement();
    this.post({
      type: "plan",
      plan: ent.tier,
      email: ent.email || "",
    });
  }

  private async pushPanelSettings(): Promise<void> {
    const config = getConfig();
    const folders =
      vscode.workspace.workspaceFolders?.map((f) => ({
        name: f.name,
        path: f.uri.fsPath,
      })) ?? [];
    let selected =
      this.context.globalState.get<string>(SELECTED_WS_KEY) ||
      folders[0]?.path ||
      "";
    if (selected && !folders.some((f) => f.path === selected)) {
      selected = folders[0]?.path || "";
      if (selected) {
        await this.context.globalState.update(SELECTED_WS_KEY, selected);
      }
    }
    const alwaysApprove =
      this.context.globalState.get<boolean>(ALWAYS_APPROVE_KEY) === true;
    this.post({
      type: "settings",
      language: config.whisperLanguage,
      languages: WHISPER_LANGUAGES,
      autoStopMs: config.audioAutoStopMs,
      workspaces: folders,
      selectedWorkspace: selected,
      alwaysApproveEdits: alwaysApprove,
    });
  }

  private postProgress(): void {
    this.post({
      type: "progress",
      steps: this.progressSteps,
      current: this.progressSteps[this.progressSteps.length - 1]?.step || "",
    });
  }

  private async cycleLanguage(): Promise<void> {
    const current = getConfig().whisperLanguage;
    const idx = WHISPER_LANGUAGES.indexOf(current);
    const next =
      WHISPER_LANGUAGES[(idx >= 0 ? idx + 1 : 0) % WHISPER_LANGUAGES.length];
    await setWhisperLanguage(next);
    await this.pushPanelSettings();
  }

  private async setLanguage(language: string): Promise<void> {
    if (!WHISPER_LANGUAGES.includes(language as WhisperLanguage)) {
      return;
    }
    await setWhisperLanguage(language as WhisperLanguage);
    await this.pushPanelSettings();
  }

  private async setSelectedWorkspace(folderPath: string): Promise<void> {
    const folders =
      vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
    if (folderPath && !folders.includes(folderPath)) {
      return;
    }
    await this.context.globalState.update(
      SELECTED_WS_KEY,
      folderPath || undefined
    );
    await this.pushPanelSettings();
  }

  private async toggleAlwaysApprove(): Promise<void> {
    const next = !(
      this.context.globalState.get<boolean>(ALWAYS_APPROVE_KEY) === true
    );
    await this.context.globalState.update(ALWAYS_APPROVE_KEY, next);
    await this.pushPanelSettings();
  }

  private async recordHistory(entry: {
    kind: HistoryKind;
    transcript: string;
    intent?: string;
    summary?: string;
    resultPreview?: string;
    error?: string;
  }): Promise<void> {
    if (!(await hasFeature("sessionHistory"))) {
      return;
    }
    await pushHistory(entry);
  }

  private async sendHistoryPage(
    offset: number,
    limit: number,
    reset = false
  ): Promise<void> {
    if (!(await hasFeature("sessionHistory"))) {
      this.post({
        type: "historyPage",
        offset: 0,
        limit: HISTORY_PAGE_SIZE,
        total: 0,
        hasMore: false,
        items: [],
        reset: true,
        pro: false,
      });
      return;
    }
    const page = getHistoryPage(offset, limit);
    this.post({
      type: "historyPage",
      offset: page.offset,
      limit: page.limit,
      total: page.total,
      hasMore: page.hasMore,
      items: page.entries.map(serializeHistoryItem),
      reset,
      pro: true,
    });
  }

  private async updateState(
    partial: Omit<PanelState, "plan" | "historyTotal" | "historyPro"> & {
      plan?: string;
      historyTotal?: number;
      historyPro?: boolean;
    }
  ): Promise<void> {
    const ent = await getEntitlement();
    const historyPro = await hasFeature("sessionHistory");
    const historyTotal = historyPro ? getHistoryPage(0, 1).total : 0;
    const state: PanelState = {
      ...partial,
      plan: partial.plan ?? ent.tier,
      historyTotal: partial.historyTotal ?? historyTotal,
      historyPro: partial.historyPro ?? historyPro,
      resultHtml: partial.resultHtml ?? "",
    };
    this.post({ type: "state", state });
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private dispose(): void {
    VoiceAgentPanel.current = undefined;
    this.recording = false;
    this.onRecordingChange?.(false);
    this.clearNativeAutoStop();
    this.abort?.abort();
    void cancelNativeCapture();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "webview", "main.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "webview", "styles.css")
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; media-src media: blob:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Voice Agent</title>
</head>
<body>
  <header class="header">
    <h1>Voice Agent <span id="planBadge" class="badge">free</span></h1>
    <p class="subtitle">Speak or type to plan, ask, edit code, or run shell commands.</p>
    <div class="header-tools">
      <button id="langBtn" class="btn" type="button" title="Whisper speech language (not the LLM). Llama 3.2: en, de, fr, it, pt, hi, es, th.">Lang: pt</button>
      <button id="alwaysApproveBtn" class="btn" type="button" title="Skip edit confirmation dialogs">Always approve edits: off</button>
      <label class="workspace-label">Workspace
        <select id="workspaceSelect" class="workspace-select">
          <option value="">Open a folder in Cursor</option>
        </select>
      </label>
    </div>
  </header>

  <section class="controls">
    <button id="micBtn" class="mic" type="button" aria-label="Toggle microphone">
      <span class="mic-icon" aria-hidden="true"></span>
      <span id="micLabel">Click to talk</span>
    </button>
    <button id="typeBtn" class="btn" type="button">Type instead</button>
    <button id="cancelBtn" class="btn danger hidden" type="button">Cancel</button>
    <div id="status" class="status" role="status" aria-live="polite">idle</div>
  </section>

  <section class="card progress-card hidden" id="progressCard">
    <h2>Progress</h2>
    <ol id="progressList" class="progress-list"></ol>
  </section>

  <section class="card">
    <h2>Transcript / Prompt
      <button id="copyTranscriptBtn" class="btn btn-inline" type="button">Copy</button>
    </h2>
    <pre id="transcript" class="block empty">—</pre>
    <textarea id="transcriptEdit" class="transcript-edit hidden" rows="4" placeholder="Speak, or type a request here…"></textarea>
    <div id="reviewActions" class="review-actions hidden">
      <button id="sendBtn" class="btn primary" type="button">Send to agent</button>
      <button id="discardBtn" class="btn" type="button">Discard</button>
    </div>
  </section>

  <section class="card">
    <h2>Intent
      <button id="copyIntentBtn" class="btn btn-inline" type="button">Copy</button>
    </h2>
    <div id="intentMeta" class="meta">—</div>
    <pre id="summary" class="block empty">—</pre>
  </section>

  <section class="card">
    <h2>Result
      <button id="copyBtn" class="btn btn-inline" type="button">Copy</button>
    </h2>
    <div id="result" class="block md empty">—</div>
    <div class="review-actions">
      <button id="retryBtn" class="btn" type="button">Retry</button>
    </div>
  </section>

  <section class="card" id="historyCard">
    <h2>Transcript history <span class="muted">(Pro)</span></h2>
    <div id="historyControls" class="history-controls">
      <button id="showHistoryBtn" class="btn" type="button">Show transcripts</button>
      <button id="hideHistoryBtn" class="btn hidden" type="button">Hide transcripts</button>
      <span id="historyCount" class="muted history-count"></span>
    </div>
    <div id="history" class="history empty">Upgrade to Pro for transcript history.</div>
    <div id="historyActions" class="review-actions hidden">
      <button id="loadMoreHistoryBtn" class="btn hidden" type="button">Load more</button>
    </div>
  </section>

  <section class="card error-card hidden" id="errorCard">
    <h2>Error</h2>
    <pre id="error" class="block"></pre>
  </section>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function serializeHistoryItem(h: HistoryEntry): Record<string, string> {
  return {
    id: h.id,
    ts: h.ts,
    kind: h.kind,
    title: historyDisplayTitle(h),
    transcript: h.transcript,
    intent: h.intent,
    summary: h.summary,
    resultPreview: h.resultPreview,
    error: h.error || "",
  };
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
