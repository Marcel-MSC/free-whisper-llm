import * as vscode from "vscode";

export interface HistoryEntry {
  id: string;
  ts: string;
  transcript: string;
  intent: string;
  summary: string;
  resultPreview: string;
}

const KEY = "voiceAgent.sessionHistory.v1";
const MAX = 50;

let state: vscode.Memento | undefined;

export function initHistory(globalState: vscode.Memento): void {
  state = globalState;
}

export function getHistory(): HistoryEntry[] {
  if (!state) {
    return [];
  }
  return state.get<HistoryEntry[]>(KEY, []);
}

export async function pushHistory(
  entry: Omit<HistoryEntry, "id" | "ts">
): Promise<void> {
  if (!state) {
    return;
  }
  const list = getHistory();
  list.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    transcript: entry.transcript.slice(0, 500),
    intent: entry.intent,
    summary: entry.summary.slice(0, 300),
    resultPreview: entry.resultPreview.slice(0, 800),
  });
  await state.update(KEY, list.slice(0, MAX));
}

export async function clearHistory(): Promise<void> {
  if (!state) {
    return;
  }
  await state.update(KEY, []);
}
