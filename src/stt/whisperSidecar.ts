import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { getConfig } from "../config";
import { resolvePythonPath, resolveScriptPath, WhisperError } from "./whisper";
import { hasFeature } from "../license/entitlements";

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (err: Error) => void;
}

let child: ChildProcessWithoutNullStreams | undefined;
let buffer = "";
let queue: Pending[] = [];
let starting: Promise<void> | undefined;

export async function stopWhisperSidecar(): Promise<void> {
  if (!child) {
    return;
  }
  try {
    child.stdin.write(JSON.stringify({ cmd: "shutdown" }) + "\n");
  } catch {
    // ignore
  }
  child.kill();
  child = undefined;
  buffer = "";
  for (const p of queue) {
    p.reject(new WhisperError("Whisper sidecar stopped."));
  }
  queue = [];
}

export async function transcribeViaSidecar(
  extensionPath: string,
  wavPath: string
): Promise<{ text: string; language?: string }> {
  const allowed = (await hasFeature("warmWhisper")) && getConfig().warmWhisper;
  if (!allowed) {
    throw new WhisperError("Warm sidecar not available on Free tier.");
  }

  await ensureSidecar(extensionPath);
  const config = getConfig();
  const result = await request({
    cmd: "transcribe",
    audio: wavPath,
    model: config.whisperModel,
    language: config.whisperLanguage,
  });

  if (!result.ok) {
    throw new WhisperError(String(result.error || "Sidecar transcription failed"));
  }
  const text = String(result.text || "").trim();
  if (!text) {
    throw new WhisperError("Whisper returned empty transcription. Try speaking again.");
  }
  return {
    text,
    language: typeof result.language === "string" ? result.language : undefined,
  };
}

async function ensureSidecar(extensionPath: string): Promise<void> {
  if (child && !child.killed) {
    return;
  }
  if (starting) {
    await starting;
    return;
  }
  starting = (async () => {
    const config = getConfig();
    const python = resolvePythonPath(extensionPath);
    const script = resolveScriptPath(extensionPath);
    child = spawn(
      python,
      [
        script,
        "--serve",
        "--model",
        config.whisperModel,
        "--language",
        config.whisperLanguage,
      ],
      {
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", onStdout);
    child.stderr.on("data", () => {
      // warm-up logs only
    });
    child.on("exit", () => {
      child = undefined;
      for (const p of queue) {
        p.reject(new WhisperError("Whisper sidecar exited."));
      }
      queue = [];
    });
    child.on("error", (err) => {
      child = undefined;
      for (const p of queue) {
        p.reject(new WhisperError(`Whisper sidecar failed: ${err.message}`));
      }
      queue = [];
    });

    // Wait briefly for process to settle
    await new Promise((r) => setTimeout(r, 200));
    try {
      await request({ cmd: "ping" }, 120_000);
    } catch (err) {
      await stopWhisperSidecar();
      throw err;
    }
  })();

  try {
    await starting;
  } finally {
    starting = undefined;
  }
}

function onStdout(chunk: string): void {
  buffer += chunk;
  let idx: number;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) {
      continue;
    }
    const pending = queue.shift();
    if (!pending) {
      continue;
    }
    try {
      pending.resolve(JSON.parse(line) as Record<string, unknown>);
    } catch (err) {
      pending.reject(
        err instanceof Error ? err : new WhisperError("Bad sidecar JSON")
      );
    }
  }
}

function request(
  payload: Record<string, unknown>,
  timeoutMs = 300_000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (!child) {
      reject(new WhisperError("Whisper sidecar not running"));
      return;
    }
    const timer = setTimeout(() => {
      const i = queue.indexOf(entry);
      if (i >= 0) {
        queue.splice(i, 1);
      }
      reject(new WhisperError("Whisper sidecar request timed out"));
    }, timeoutMs);
    const entry: Pending = {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    };
    queue.push(entry);
    try {
      child.stdin.write(JSON.stringify(payload) + "\n");
    } catch (err) {
      queue.pop();
      clearTimeout(timer);
      reject(
        err instanceof Error ? err : new WhisperError("Failed to write to sidecar")
      );
    }
  });
}
