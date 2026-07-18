import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn, ChildProcessWithoutNullStreams, execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export class NativeCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeCaptureError";
  }
}

export type CaptureBackend = "parecord" | "arecord" | "ffmpeg";

export interface NativeCaptureAvailability {
  available: boolean;
  backend?: CaptureBackend;
  detail: string;
}

let activeProcess: ChildProcessWithoutNullStreams | undefined;
let activeWavPath: string | undefined;
let activeBackend: CaptureBackend | undefined;

function whichSync(cmd: string): string | undefined {
  const pathEnv = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE").split(";").map((e) => e.toLowerCase())
      : [""];

  for (const dir of pathEnv.split(sep)) {
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {
        // continue
      }
    }
  }
  return undefined;
}

/** Detect whether the extension host can record via PulseAudio/ALSA/ffmpeg. */
export async function probeNativeCapture(): Promise<NativeCaptureAvailability> {
  if (process.platform === "win32") {
    return {
      available: false,
      detail: "Native capture is for Linux/WSL (PulseAudio). Use webview mic on Windows.",
    };
  }

  // Prefer PulseAudio (WSLg exposes /mnt/wslg/PulseServer)
  if (whichSync("parecord")) {
    return {
      available: true,
      backend: "parecord",
      detail: "PulseAudio parecord (WSLg/Pulse)",
    };
  }
  if (whichSync("ffmpeg")) {
    // ffmpeg can use pulse or alsa
    return {
      available: true,
      backend: "ffmpeg",
      detail: "ffmpeg pulse/default",
    };
  }
  if (whichSync("arecord")) {
    return {
      available: true,
      backend: "arecord",
      detail: "ALSA arecord",
    };
  }

  return {
    available: false,
    detail:
      "No recorder found. On WSL/Ubuntu install: sudo apt install pulseaudio-utils alsa-utils",
  };
}

export function isNativeCaptureActive(): boolean {
  return Boolean(activeProcess);
}

export async function startNativeCapture(): Promise<{ wavPath: string; backend: CaptureBackend }> {
  if (activeProcess) {
    throw new NativeCaptureError("Native capture already running.");
  }

  const probe = await probeNativeCapture();
  if (!probe.available || !probe.backend) {
    throw new NativeCaptureError(probe.detail);
  }

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "voice-agent-native-"));
  const wavPath = path.join(dir, "recording.wav");
  const backend = probe.backend;

  const env = {
    ...process.env,
    // Ensure WSLg Pulse is used when present
    PULSE_SERVER: process.env.PULSE_SERVER || "unix:/mnt/wslg/PulseServer",
  };

  let child: ChildProcessWithoutNullStreams;
  switch (backend) {
    case "parecord":
      // 16-bit mono 16 kHz WAV — Whisper-friendly
      child = spawn(
        "parecord",
        [
          "--channels=1",
          "--rate=16000",
          "--format=s16le",
          "--file-format=wav",
          wavPath,
        ],
        { env }
      );
      break;
    case "ffmpeg":
      child = spawn(
        "ffmpeg",
        [
          "-y",
          "-f",
          "pulse",
          "-i",
          "default",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          wavPath,
        ],
        { env }
      );
      break;
    case "arecord":
      child = spawn(
        "arecord",
        ["-f", "S16_LE", "-c", "1", "-r", "16000", "-t", "wav", wavPath],
        { env }
      );
      break;
  }

  let stderr = "";
  child.stderr.on("data", (d: Buffer) => {
    stderr += d.toString();
  });

  const spawnError = await new Promise<Error | undefined>((resolve) => {
    const onError = (err: Error) => {
      cleanup();
      resolve(err);
    };
    const onExitEarly = (code: number | null) => {
      cleanup();
      resolve(
        new NativeCaptureError(
          `${backend} exited early (${code}): ${(stderr || "no stderr").slice(0, 400)}`
        )
      );
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(undefined);
    }, 300);

    function cleanup() {
      clearTimeout(timer);
      child.removeListener("error", onError);
      child.removeListener("exit", onExitEarly);
    }

    child.once("error", onError);
    child.once("exit", onExitEarly);
  });

  if (spawnError) {
    await cleanupCaptureDir(wavPath);
    throw spawnError instanceof NativeCaptureError
      ? spawnError
      : new NativeCaptureError(
          `Failed to start ${backend}: ${spawnError.message}. ${probe.detail}`
        );
  }

  activeProcess = child;
  activeWavPath = wavPath;
  activeBackend = backend;
  return { wavPath, backend };
}

export async function stopNativeCapture(): Promise<string> {
  if (!activeProcess || !activeWavPath) {
    throw new NativeCaptureError("No native capture in progress.");
  }

  const child = activeProcess;
  const wavPath = activeWavPath;
  const backend = activeBackend;

  activeProcess = undefined;
  activeWavPath = undefined;
  activeBackend = undefined;

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    child.once("exit", done);
    child.once("close", done);

    // Graceful stop for recorders
    try {
      if (backend === "ffmpeg") {
        child.stdin.write("q");
        child.stdin.end();
      } else {
        child.kill("SIGINT");
      }
    } catch {
      child.kill("SIGKILL");
    }

    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve();
    }, 2000);
  });

  // Small settle for filesystem flush
  await delay(150);

  try {
    const stat = await fs.promises.stat(wavPath);
    if (stat.size < 1000) {
      await cleanupCaptureDir(wavPath);
      throw new NativeCaptureError(
        "Recording too short or empty. Check mic permissions in Windows and that WSLg audio works (parecord)."
      );
    }
  } catch (err) {
    if (err instanceof NativeCaptureError) {
      throw err;
    }
    await cleanupCaptureDir(wavPath);
    throw new NativeCaptureError(
      `Recording file missing after stop: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return wavPath;
}

export async function cancelNativeCapture(): Promise<void> {
  if (!activeProcess || !activeWavPath) {
    return;
  }
  const child = activeProcess;
  const wavPath = activeWavPath;
  activeProcess = undefined;
  activeWavPath = undefined;
  activeBackend = undefined;
  try {
    child.kill("SIGKILL");
  } catch {
    // ignore
  }
  await cleanupCaptureDir(wavPath);
}

async function cleanupCaptureDir(wavPath: string): Promise<void> {
  try {
    const dir = path.dirname(wavPath);
    await fs.promises.unlink(wavPath).catch(() => undefined);
    await fs.promises.rmdir(dir).catch(() => undefined);
  } catch {
    // ignore
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Prefer native on Linux/WSL; webview elsewhere unless forced. */
export function defaultCaptureMode(
  configured: "auto" | "webview" | "native"
): "webview" | "native" {
  if (configured === "webview" || configured === "native") {
    return configured;
  }
  // auto
  if (process.platform === "linux") {
    return "native";
  }
  return "webview";
}

export async function listPulseSources(): Promise<string> {
  if (!whichSync("pactl")) {
    return "";
  }
  try {
    const { stdout } = await execFileAsync("pactl", ["list", "sources", "short"], {
      env: {
        ...process.env,
        PULSE_SERVER: process.env.PULSE_SERVER || "unix:/mnt/wslg/PulseServer",
      },
    });
    return stdout.trim();
  } catch {
    return "";
  }
}
