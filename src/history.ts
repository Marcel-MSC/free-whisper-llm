import type { Memento } from "vscode";

export type HistoryKind =
  | "draft_transcribed"
  | "draft_typed"
  | "draft_discarded"
  | "run_success"
  | "run_error"
  | "run_cancelled";

export interface HistoryEntry {
  id: string;
  ts: string;
  kind: HistoryKind;
  transcript: string;
  intent: string;
  summary: string;
  resultPreview: string;
  error?: string;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number;
}

const KEY_V1 = "voiceAgent.sessionHistory.v1";
const KEY_V2 = "voiceAgent.sessionHistory.v2";

const DEFAULT_MAX = 100;
const HARD_CEILING = 500;
export const HISTORY_PAGE_SIZE = 10;

const TRUNC = {
  transcript: 500,
  summary: 300,
  resultPreview: 800,
  error: 400,
} as const;

let state: Memento | undefined;
let maxEntriesFn: () => number = () => DEFAULT_MAX;
let recordDraftsFn: () => boolean = () => true;

export function initHistory(globalState: Memento): void {
  state = globalState;
}

export function configureHistory(options: {
  maxEntries: () => number;
  recordDrafts: () => boolean;
}): void {
  maxEntriesFn = options.maxEntries;
  recordDraftsFn = options.recordDrafts;
}

/** Test helper — inject a fake Memento without vscode runtime. */
export function initHistoryForTests(
  globalState: Memento,
  maxEntries?: number
): void {
  state = globalState;
  maxEntriesFn = () =>
    typeof maxEntries === "number" ? clampMax(maxEntries) : DEFAULT_MAX;
  recordDraftsFn = () => true;
}

function clampMax(n: number): number {
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_MAX;
  }
  return Math.min(Math.floor(n), HARD_CEILING);
}

function resolveMaxEntries(): number {
  return clampMax(maxEntriesFn());
}

function isHistoryKind(v: unknown): v is HistoryKind {
  return (
    v === "draft_transcribed" ||
    v === "draft_typed" ||
    v === "draft_discarded" ||
    v === "run_success" ||
    v === "run_error" ||
    v === "run_cancelled"
  );
}

function normalizeEntry(raw: unknown): HistoryEntry | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const transcript = typeof o.transcript === "string" ? o.transcript : "";
  const id =
    typeof o.id === "string" && o.id
      ? o.id
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ts =
    typeof o.ts === "string" && o.ts ? o.ts : new Date().toISOString();
  const kind: HistoryKind = isHistoryKind(o.kind) ? o.kind : "run_success";
  return {
    id,
    ts,
    kind,
    transcript: transcript.slice(0, TRUNC.transcript),
    intent: typeof o.intent === "string" ? o.intent : "",
    summary:
      typeof o.summary === "string" ? o.summary.slice(0, TRUNC.summary) : "",
    resultPreview:
      typeof o.resultPreview === "string"
        ? o.resultPreview.slice(0, TRUNC.resultPreview)
        : "",
    error:
      typeof o.error === "string" && o.error
        ? o.error.slice(0, TRUNC.error)
        : undefined,
  };
}

function readRawList(): unknown[] {
  if (!state) {
    return [];
  }
  const v2 = state.get<unknown>(KEY_V2);
  if (Array.isArray(v2)) {
    return v2;
  }
  const v1 = state.get<unknown>(KEY_V1);
  if (Array.isArray(v1)) {
    return v1;
  }
  return [];
}

export function getHistory(): HistoryEntry[] {
  return readRawList()
    .map(normalizeEntry)
    .filter((e): e is HistoryEntry => !!e);
}

export function getHistoryPage(
  offset = 0,
  limit = HISTORY_PAGE_SIZE
): HistoryPage {
  const all = getHistory();
  const safeOffset = Math.max(0, Math.floor(offset) || 0);
  const safeLimit = Math.max(
    1,
    Math.min(Math.floor(limit) || HISTORY_PAGE_SIZE, 50)
  );
  const entries = all.slice(safeOffset, safeOffset + safeLimit);
  return {
    entries,
    total: all.length,
    hasMore: safeOffset + entries.length < all.length,
    offset: safeOffset,
    limit: safeLimit,
  };
}

export type PushHistoryInput = {
  kind: HistoryKind;
  transcript: string;
  intent?: string;
  summary?: string;
  resultPreview?: string;
  error?: string;
};

export async function pushHistory(entry: PushHistoryInput): Promise<void> {
  if (!state) {
    return;
  }
  const list = getHistory();
  list.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    kind: entry.kind,
    transcript: (entry.transcript || "").slice(0, TRUNC.transcript),
    intent: entry.intent || "",
    summary: (entry.summary || "").slice(0, TRUNC.summary),
    resultPreview: (entry.resultPreview || "").slice(0, TRUNC.resultPreview),
    error: entry.error ? entry.error.slice(0, TRUNC.error) : undefined,
  });
  const max = resolveMaxEntries();
  await state.update(KEY_V2, list.slice(0, max));
  // Drop legacy key after first successful v2 write so we do not dual-store.
  if (state.get(KEY_V1) !== undefined) {
    await state.update(KEY_V1, undefined);
  }
}

export async function clearHistory(): Promise<void> {
  if (!state) {
    return;
  }
  await state.update(KEY_V2, []);
  await state.update(KEY_V1, undefined);
}

export function recordDraftsEnabled(): boolean {
  return recordDraftsFn();
}

/** Short title for transcript history list (intent resume). */
export function historyDisplayTitle(entry: HistoryEntry): string {
  const summary = (entry.summary || "").trim();
  if (summary) {
    return summary.slice(0, 120);
  }
  const intent = (entry.intent || "").trim();
  const transcript = (entry.transcript || "").trim();
  if (intent && transcript) {
    return `${intent}: ${transcript.slice(0, 80)}`;
  }
  if (intent) {
    return intent;
  }
  switch (entry.kind) {
    case "draft_transcribed":
      return transcript ? `Voice: ${transcript.slice(0, 80)}` : "Voice draft";
    case "draft_typed":
      return transcript ? `Typed: ${transcript.slice(0, 80)}` : "Typed draft";
    case "draft_discarded":
      return transcript ? `Discarded: ${transcript.slice(0, 80)}` : "Discarded";
    case "run_error":
      return transcript ? `Error: ${transcript.slice(0, 80)}` : "Run error";
    case "run_cancelled":
      return transcript ? `Cancelled: ${transcript.slice(0, 80)}` : "Cancelled";
    default:
      return transcript.slice(0, 100) || "Transcript";
  }
}
