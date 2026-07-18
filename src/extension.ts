import * as vscode from "vscode";
import { VoiceAgentPanel } from "./ui/panel";
import { ensureWhisperReady, setupWhisper, WhisperError } from "./stt/whisper";

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
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
            void vscode.window.showInformationMessage(msg);
          } catch (err) {
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
}

export function deactivate(): void {
  // nothing
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
