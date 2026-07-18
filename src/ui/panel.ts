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
import { getConfig } from "../config";

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
  error: string;
}

type ActiveMode = "webview" | "native";

export class VoiceAgentPanel {
  public static readonly viewType = "voiceAgent.panel";
  private static current: VoiceAgentPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly extensionPath: string;
  private disposables: vscode.Disposable[] = [];
  private recording = false;
  private activeMode: ActiveMode = "webview";
  private onRecordingChange?: (recording: boolean) => void;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    extensionPath: string,
    onRecordingChange?: (recording: boolean) => void
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.extensionPath = extensionPath;
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
      context.extensionUri,
      context.extensionPath,
      onRecordingChange
    );
    return VoiceAgentPanel.current;
  }

  public async startRecording(): Promise<void> {
    const config = getConfig();
    const preferred = defaultCaptureMode(config.audioCaptureMode);
    const native = await probeNativeCapture();

    if (preferred === "native" && native.available) {
      await this.startNative();
      return;
    }

    if (preferred === "native" && !native.available) {
      // Fall back to webview with a clear hint if it also fails
      this.activeMode = "webview";
      this.recording = true;
      this.onRecordingChange?.(true);
      this.post({ type: "startRecording" });
      this.updateState({
        status: "recording",
        transcript: "",
        intent: "",
        confidence: 0,
        summary: "",
        result: "",
        error: "",
      });
      return;
    }

    // webview preferred (or auto on non-Linux)
    this.activeMode = "webview";
    this.recording = true;
    this.onRecordingChange?.(true);
    this.post({ type: "startRecording" });
    this.updateState({
      status: "recording",
      transcript: "",
      intent: "",
      confidence: 0,
      summary: "",
      result: "",
      error: "",
    });
  }

  public async stopRecording(): Promise<void> {
    if (this.activeMode === "native" || isNativeCaptureActive()) {
      await this.stopNative();
      return;
    }
    this.post({ type: "stopRecording" });
  }

  public isRecording(): boolean {
    return this.recording;
  }

  private async startNative(): Promise<void> {
    try {
      const { backend } = await startNativeCapture();
      this.activeMode = "native";
      this.recording = true;
      this.onRecordingChange?.(true);
      this.post({ type: "nativeRecording", active: true });
      this.updateState({
        status: "recording",
        transcript: "",
        intent: "",
        confidence: 0,
        summary: `Native mic (${backend}) — speak, then click stop`,
        result: "",
        error: "",
      });
    } catch (err) {
      const message =
        err instanceof NativeCaptureError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      this.recording = false;
      this.onRecordingChange?.(false);
      this.updateState({
        status: "error",
        transcript: "",
        intent: "",
        confidence: 0,
        summary: "",
        result: "",
        error: message,
      });
      void vscode.window.showErrorMessage(`Voice Agent: ${message}`);
    }
  }

  private async stopNative(): Promise<void> {
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
      this.updateState({
        status: "error",
        transcript: "",
        intent: "",
        confidence: 0,
        summary: "",
        result: "",
        error: message,
      });
      void vscode.window.showErrorMessage(`Voice Agent: ${message}`);
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
        // Webview getUserMedia failed — try native (WSL/Pulse) automatically
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
          this.updateState({
            status: "error",
            transcript: "",
            intent: "",
            confidence: 0,
            summary: "",
            result: "",
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
        this.updateState({
          status: "error",
          transcript: "",
          intent: "",
          confidence: 0,
          summary: "",
          result: "",
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
      case "discardTranscript":
        this.updateState({
          status: "idle",
          transcript: "",
          intent: "",
          confidence: 0,
          summary: "",
          result: "",
          error: "",
        });
        break;
    }
  }

  private async handleAudio(base64Wav: string): Promise<void> {
    this.recording = false;
    this.onRecordingChange?.(false);

    let wavPath: string | undefined;
    try {
      this.updateState({
        status: "transcribing",
        transcript: "",
        intent: "",
        confidence: 0,
        summary: "",
        result: "",
        error: "",
      });

      wavPath = await writeWavTemp(base64Wav);
      await this.transcribeAndRun(wavPath);
    } catch (err) {
      this.showErr(err);
    } finally {
      if (wavPath) {
        await cleanupTemp(wavPath);
      }
    }
  }

  private async handleWavPath(wavPath: string): Promise<void> {
    try {
      this.updateState({
        status: "transcribing",
        transcript: "",
        intent: "",
        confidence: 0,
        summary: "",
        result: "",
        error: "",
      });
      await this.transcribeAndRun(wavPath);
    } catch (err) {
      this.showErr(err);
    } finally {
      await cleanupTemp(wavPath);
    }
  }

  private async transcribeAndRun(wavPath: string): Promise<void> {
    const { text } = await transcribeWav(this.extensionPath, wavPath);

    // Pause for user review/edit before calling the LLM
    this.updateState({
      status: "review",
      transcript: text,
      intent: "",
      confidence: 0,
      summary: "Review the transcript, edit if needed, then Send.",
      result: "",
      error: "",
    });
  }

  private async runWithTranscript(raw: string): Promise<void> {
    const text = raw.trim();
    if (!text) {
      this.updateState({
        status: "error",
        transcript: "",
        intent: "",
        confidence: 0,
        summary: "",
        result: "",
        error: "Transcript is empty. Record again or type something before Send.",
      });
      return;
    }

    try {
      this.updateState({
        status: "routing",
        transcript: text,
        intent: "",
        confidence: 0,
        summary: "",
        result: "",
        error: "",
      });

      this.updateState({
        status: "running",
        transcript: text,
        intent: "…",
        confidence: 0,
        summary: "Running agent…",
        result: "",
        error: "",
      });

      const run = await runAgent(text);

      this.updateState({
        status: "done",
        transcript: run.transcript,
        intent: run.routed.intent,
        confidence: run.routed.confidence,
        summary: run.routed.summary,
        result: run.resultMarkdown,
        error: "",
      });
    } catch (err) {
      this.showErr(err);
    }
  }

  private showErr(err: unknown): void {
    const message =
      err instanceof WhisperError || err instanceof NativeCaptureError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    this.updateState({
      status: "error",
      transcript: "",
      intent: "",
      confidence: 0,
      summary: "",
      result: "",
      error: message,
    });
    void vscode.window.showErrorMessage(`Voice Agent: ${message}`);
  }

  private updateState(state: PanelState): void {
    this.post({ type: "state", state });
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private dispose(): void {
    VoiceAgentPanel.current = undefined;
    this.recording = false;
    this.onRecordingChange?.(false);
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
    <h1>Voice Agent</h1>
    <p class="subtitle">Speak to plan, ask, edit code, or run shell commands.</p>
  </header>

  <section class="controls">
    <button id="micBtn" class="mic" type="button" aria-label="Toggle microphone">
      <span class="mic-icon" aria-hidden="true"></span>
      <span id="micLabel">Click to talk</span>
    </button>
    <div id="status" class="status">idle</div>
  </section>

  <section class="card">
    <h2>Transcript</h2>
    <pre id="transcript" class="block empty">—</pre>
    <textarea id="transcriptEdit" class="transcript-edit hidden" rows="4" placeholder="Transcript will appear here…"></textarea>
    <div id="reviewActions" class="review-actions hidden">
      <button id="sendBtn" class="btn primary" type="button">Send to agent</button>
      <button id="discardBtn" class="btn" type="button">Discard</button>
    </div>
  </section>

  <section class="card">
    <h2>Intent</h2>
    <div id="intentMeta" class="meta">—</div>
    <pre id="summary" class="block empty">—</pre>
  </section>

  <section class="card">
    <h2>Result</h2>
    <pre id="result" class="block empty">—</pre>
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

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
