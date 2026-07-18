import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { spawn } from "child_process";
import { getConfig } from "../config";

export class WhisperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhisperError";
  }
}

export interface TranscribeResult {
  text: string;
  language?: string;
}

/** Stable user data dir — survives VSIX reinstalls (extension folder does not keep .venv). */
export function sharedDataDir(): string {
  return path.join(os.homedir(), ".local", "share", "voice-agent");
}

export function sharedVenvPython(): string {
  if (process.platform === "win32") {
    return path.join(sharedDataDir(), ".venv", "Scripts", "python.exe");
  }
  return path.join(sharedDataDir(), ".venv", "bin", "python");
}

export function resolveScriptPath(extensionPath: string): string {
  const config = getConfig();
  if (config.scriptPath.trim()) {
    return config.scriptPath.trim();
  }
  return path.join(extensionPath, "scripts", "whisper_transcribe.py");
}

/**
 * Prefer (in order):
 * 1. explicit voiceAgent.whisper.pythonPath
 * 2. ~/.local/share/voice-agent/.venv (shared, for VSIX installs)
 * 3. extensionPath/.venv (dev / local clone)
 * 4. workspace .venv if open
 * 5. python3
 */
export function resolvePythonPath(extensionPath: string): string {
  const config = getConfig();
  const configured = config.pythonPath.trim();
  const isDefault = !configured || configured === "python3" || configured === "python";

  if (!isDefault) {
    return configured;
  }

  const candidates: string[] = [sharedVenvPython()];

  if (process.platform === "win32") {
    candidates.push(path.join(extensionPath, ".venv", "Scripts", "python.exe"));
  } else {
    candidates.push(path.join(extensionPath, ".venv", "bin", "python"));
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    if (process.platform === "win32") {
      candidates.push(path.join(folder.uri.fsPath, ".venv", "Scripts", "python.exe"));
    } else {
      candidates.push(path.join(folder.uri.fsPath, ".venv", "bin", "python"));
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return configured || "python3";
}

export async function ensureWhisperReady(extensionPath: string): Promise<void> {
  const script = resolveScriptPath(extensionPath);
  if (!fs.existsSync(script)) {
    throw new WhisperError(`Whisper script not found: ${script}`);
  }

  const python = resolvePythonPath(extensionPath);
  await runPython(python, [script, "--check"], extensionPath);
}

export async function setupWhisper(extensionPath: string): Promise<string> {
  const config = getConfig();
  const script = resolveScriptPath(extensionPath);
  const setupSh = path.join(extensionPath, "scripts", "setup_whisper.sh");
  const dataDir = sharedDataDir();
  const venvDir = path.join(dataDir, ".venv");

  await fs.promises.mkdir(dataDir, { recursive: true });

  if (process.platform !== "win32" && fs.existsSync(setupSh)) {
    const output = await runCommand(
      "bash",
      [setupSh],
      extensionPath,
      600_000,
      {
        VOICE_AGENT_PYTHON: config.pythonPath.trim() || "python3",
        VOICE_AGENT_VENV: venvDir,
        WHISPER_MODEL: config.whisperModel,
      }
    );
    return (
      output.trim() ||
      `Whisper setup completed. Using ${sharedVenvPython()}`
    );
  }

  // Windows / fallback: create shared venv via system Python, then pip install
  const systemPython = config.pythonPath.trim() || "python3";
  const venvPython = sharedVenvPython();

  if (!fs.existsSync(venvPython)) {
    await runPython(systemPython, ["-m", "venv", venvDir], extensionPath, 120_000);
  }

  const requirements = path.join(extensionPath, "scripts", "requirements.txt");
  await runPython(venvPython, ["-m", "pip", "install", "-U", "pip"], extensionPath, 180_000);
  await runPython(
    venvPython,
    ["-m", "pip", "install", "-r", requirements],
    extensionPath,
    600_000
  );

  if (!fs.existsSync(script)) {
    throw new WhisperError(`Whisper script not found: ${script}`);
  }

  const output = await runPython(
    venvPython,
    [script, "--setup", "--model", config.whisperModel],
    extensionPath,
    600_000
  );
  return output.trim() || `Whisper setup completed. Using ${venvPython}`;
}

export async function transcribeWav(
  extensionPath: string,
  wavPath: string
): Promise<TranscribeResult> {
  const config = getConfig();
  const script = resolveScriptPath(extensionPath);
  const python = resolvePythonPath(extensionPath);

  if (!fs.existsSync(wavPath)) {
    throw new WhisperError(`Audio file not found: ${wavPath}`);
  }
  if (!fs.existsSync(script)) {
    throw new WhisperError(`Whisper script not found: ${script}`);
  }

  const args = [
    script,
    "--audio",
    wavPath,
    "--model",
    config.whisperModel,
    "--language",
    config.whisperLanguage,
    "--json",
  ];

  const stdout = await runPython(python, args, extensionPath, 300_000);
  const parsed = parseJsonOutput(stdout);
  const text = (parsed.text ?? "").trim();
  if (!text) {
    throw new WhisperError("Whisper returned empty transcription. Try speaking again.");
  }
  return { text, language: parsed.language };
}

export async function writeWavTemp(base64Wav: string): Promise<string> {
  const buf = Buffer.from(base64Wav, "base64");
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "voice-agent-"));
  const file = path.join(dir, "recording.wav");
  await fs.promises.writeFile(file, buf);
  return file;
}

export async function cleanupTemp(filePath: string): Promise<void> {
  try {
    const dir = path.dirname(filePath);
    await fs.promises.unlink(filePath);
    await fs.promises.rmdir(dir);
  } catch {
    // ignore cleanup errors
  }
}

function parseJsonOutput(stdout: string): { text?: string; language?: string } {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        return JSON.parse(line) as { text?: string; language?: string };
      } catch {
        // continue
      }
    }
  }
  try {
    return JSON.parse(stdout.trim()) as { text?: string; language?: string };
  } catch {
    throw new WhisperError(`Could not parse Whisper output:\n${stdout.slice(0, 500)}`);
  }
}

function runPython(
  pythonPath: string,
  args: string[],
  cwd: string,
  timeoutMs = 120_000
): Promise<string> {
  return runCommand(pythonPath, args, cwd, timeoutMs);
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 120_000,
  extraEnv?: Record<string, string>
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: "1", ...extraEnv },
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new WhisperError(`Command timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new WhisperError(
          `Failed to start (${command}): ${err.message}. Install Python 3 + python3-venv and run "Voice Agent: Setup Whisper".`
        )
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout || stderr);
        return;
      }
      const detail = (stderr || stdout || `exit ${code}`).trim();
      reject(new WhisperError(detail));
    });
  });
}

export async function pickSaveWav(base64Wav: string): Promise<string | undefined> {
  const uri = await vscode.window.showSaveDialog({
    filters: { WAV: ["wav"] },
    saveLabel: "Save recording",
  });
  if (!uri) {
    return undefined;
  }
  await fs.promises.writeFile(uri.fsPath, Buffer.from(base64Wav, "base64"));
  return uri.fsPath;
}
