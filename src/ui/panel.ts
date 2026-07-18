import * as vscode from "vscode";
import { runAgent } from "../agent/run";
import {
  transcribeWav,
  writeWavTemp,
  cleanupTemp,
  WhisperError,
} from "../stt/whisper";

export type PanelStatus =
  | "idle"
  | "recording"
  | "transcribing"
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

export class VoiceAgentPanel {
  public static readonly viewType = "voiceAgent.panel";
  private static current: VoiceAgentPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly extensionPath: string;
  private disposables: vscode.Disposable[] = [];
  private recording = false;
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
      (msg) => this.onMessage(msg),
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

  public startRecording(): void {
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

  public stopRecording(): void {
    this.post({ type: "stopRecording" });
  }

  public isRecording(): boolean {
    return this.recording;
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
        this.recording = false;
        this.onRecordingChange?.(false);
        break;
      case "audio":
        if (typeof msg.base64Wav === "string") {
          await this.handleAudio(msg.base64Wav);
        }
        break;
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
          this.stopRecording();
        } else {
          this.startRecording();
        }
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
      const { text } = await transcribeWav(this.extensionPath, wavPath);

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
      const message =
        err instanceof WhisperError
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
    } finally {
      if (wavPath) {
        await cleanupTemp(wavPath);
      }
    }
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
