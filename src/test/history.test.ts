import * as assert from "assert";
import {
  initHistoryForTests,
  getHistory,
  getHistoryPage,
  pushHistory,
  clearHistory,
  HISTORY_PAGE_SIZE,
  historyDisplayTitle,
  type HistoryEntry,
} from "../history";

class FakeMemento {
  private store = new Map<string, unknown>();

  get<T>(key: string, defaultValue?: T): T {
    if (this.store.has(key)) {
      return this.store.get(key) as T;
    }
    return defaultValue as T;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.store.delete(key);
    } else {
      this.store.set(key, value);
    }
  }

  keys(): readonly string[] {
    return [...this.store.keys()];
  }

  setRaw(key: string, value: unknown): void {
    this.store.set(key, value);
  }
}

async function main(): Promise<void> {
  // Empty / uninitialized
  const empty = new FakeMemento();
  initHistoryForTests(empty as never, 100);
  assert.deepStrictEqual(getHistory(), []);
  const emptyPage = getHistoryPage(0, 10);
  assert.strictEqual(emptyPage.total, 0);
  assert.strictEqual(emptyPage.hasMore, false);
  assert.strictEqual(emptyPage.entries.length, 0);

  // Push kinds + newest-first
  const mem = new FakeMemento();
  initHistoryForTests(mem as never, 100);
  await pushHistory({
    kind: "draft_transcribed",
    transcript: "first voice",
    summary: "voice",
  });
  await pushHistory({
    kind: "run_success",
    transcript: "second run",
    intent: "ask",
    summary: "ok",
    resultPreview: "answer",
  });
  const list = getHistory();
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].transcript, "second run");
  assert.strictEqual(list[0].kind, "run_success");
  assert.strictEqual(list[1].kind, "draft_transcribed");

  // Truncation
  const long = "x".repeat(2000);
  await pushHistory({
    kind: "run_error",
    transcript: long,
    summary: long,
    resultPreview: long,
    error: long,
  });
  const top = getHistory()[0];
  assert.strictEqual(top.transcript.length, 500);
  assert.strictEqual(top.summary.length, 300);
  assert.strictEqual(top.resultPreview.length, 800);
  assert.ok(top.error);
  assert.strictEqual(top.error!.length, 400);

  // maxEntries eviction
  const capped = new FakeMemento();
  initHistoryForTests(capped as never, 3);
  for (let i = 0; i < 5; i++) {
    await pushHistory({
      kind: "draft_typed",
      transcript: `n${i}`,
      summary: `s${i}`,
    });
  }
  const cappedList = getHistory();
  assert.strictEqual(cappedList.length, 3);
  assert.strictEqual(cappedList[0].transcript, "n4");
  assert.strictEqual(cappedList[2].transcript, "n2");

  // Pagination
  const pageMem = new FakeMemento();
  initHistoryForTests(pageMem as never, 100);
  for (let i = 0; i < 25; i++) {
    await pushHistory({
      kind: "draft_typed",
      transcript: `p${i}`,
    });
  }
  const page0 = getHistoryPage(0, HISTORY_PAGE_SIZE);
  assert.strictEqual(page0.entries.length, 10);
  assert.strictEqual(page0.total, 25);
  assert.strictEqual(page0.hasMore, true);
  assert.strictEqual(page0.entries[0].transcript, "p24");

  const page1 = getHistoryPage(10, HISTORY_PAGE_SIZE);
  assert.strictEqual(page1.entries.length, 10);
  assert.strictEqual(page1.hasMore, true);
  assert.strictEqual(page1.entries[0].transcript, "p14");

  const page2 = getHistoryPage(20, HISTORY_PAGE_SIZE);
  assert.strictEqual(page2.entries.length, 5);
  assert.strictEqual(page2.hasMore, false);

  // Clear
  await clearHistory();
  assert.deepStrictEqual(getHistory(), []);
  const cleared = pageMem.get<unknown[]>("voiceAgent.sessionHistory.v2", []);
  assert.strictEqual(cleared.length, 0);

  // v1 → v2 migration shape
  const legacy = new FakeMemento();
  const v1Entries: Array<Partial<HistoryEntry>> = [
    {
      id: "old-1",
      ts: "2026-01-01T00:00:00.000Z",
      transcript: "legacy voice",
      intent: "plan",
      summary: "old summary",
      resultPreview: "old result",
    },
  ];
  legacy.setRaw("voiceAgent.sessionHistory.v1", v1Entries);
  initHistoryForTests(legacy as never, 100);
  const migrated = getHistory();
  assert.strictEqual(migrated.length, 1);
  assert.strictEqual(migrated[0].transcript, "legacy voice");
  assert.strictEqual(migrated[0].kind, "run_success"); // default for v1

  await pushHistory({
    kind: "draft_discarded",
    transcript: "new discard",
  });
  assert.strictEqual(getHistory().length, 2);
  assert.strictEqual(legacy.get("voiceAgent.sessionHistory.v1"), undefined);
  assert.ok(Array.isArray(legacy.get("voiceAgent.sessionHistory.v2")));

  // Display title prefers summary / intent resume
  assert.strictEqual(
    historyDisplayTitle({
      id: "1",
      ts: "",
      kind: "run_success",
      transcript: "long transcript text",
      intent: "edit",
      summary: "Rename helper function",
      resultPreview: "",
    }),
    "Rename helper function"
  );
  assert.strictEqual(
    historyDisplayTitle({
      id: "2",
      ts: "",
      kind: "draft_transcribed",
      transcript: "please open the file",
      intent: "",
      summary: "",
      resultPreview: "",
    }),
    "Voice: please open the file"
  );

  console.log("history tests passed");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
