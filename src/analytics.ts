import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Privacy-safe local analytics. Never stores audio, source code, or transcripts.
 * Events are written to a local JSONL file the user can inspect or delete.
 */

export type AnalyticsEventName =
  | "setup_success"
  | "setup_failure"
  | "transcribe_ok"
  | "transcribe_error"
  | "agent_intent"
  | "edit_accept"
  | "edit_reject"
  | "shell_run"
  | "shell_block"
  | "purchase_click"
  | "license_activate"
  | "license_deactivate"
  | "first_success";

export interface AnalyticsEvent {
  ts: string;
  name: AnalyticsEventName;
  props?: Record<string, string | number | boolean>;
}

const MAX_FILE_BYTES = 512_000;

export function analyticsEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("voiceAgent")
    .get<boolean>("analytics.enabled", true);
}

export function analyticsPath(): string {
  return path.join(os.homedir(), ".local", "share", "voice-agent", "analytics.jsonl");
}

export async function track(
  name: AnalyticsEventName,
  props?: Record<string, string | number | boolean>
): Promise<void> {
  if (!analyticsEnabled()) {
    return;
  }
  const event: AnalyticsEvent = {
    ts: new Date().toISOString(),
    name,
    props: sanitizeProps(props),
  };
  try {
    const file = analyticsPath();
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    try {
      const stat = await fs.promises.stat(file);
      if (stat.size > MAX_FILE_BYTES) {
        await fs.promises.rename(file, file + ".1");
      }
    } catch {
      // missing is fine
    }
    await fs.promises.appendFile(file, JSON.stringify(event) + "\n", "utf8");
  } catch {
    // never break the product for analytics
  }
}

function sanitizeProps(
  props?: Record<string, string | number | boolean>
): Record<string, string | number | boolean> | undefined {
  if (!props) {
    return undefined;
  }
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === "string") {
      // Cap strings; never allow long free text that might be code/transcript.
      out[k] = v.slice(0, 64);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function summarizeAnalytics(): Promise<string> {
  const file = analyticsPath();
  try {
    const text = await fs.promises.readFile(file, "utf8");
    const counts = new Map<string, number>();
    for (const line of text.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const ev = JSON.parse(line) as AnalyticsEvent;
        counts.set(ev.name, (counts.get(ev.name) || 0) + 1);
      } catch {
        // skip
      }
    }
    if (!counts.size) {
      return "No analytics events yet.";
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name}: ${n}`)
      .join("\n");
  } catch {
    return "No analytics file yet.";
  }
}
