export interface LineDiff {
  path: string;
  unified: string;
  added: number;
  removed: number;
  isNew: boolean;
}

/** Minimal unified diff for confirmation UI (no external deps). */
export function unifiedDiff(
  filePath: string,
  before: string,
  after: string
): LineDiff {
  const a = before.split("\n");
  const b = after.split("\n");
  const isNew = before.length === 0 && after.length > 0;

  // LCS-based diff for small/medium files; fall back to coarse dump if huge.
  if (a.length * b.length > 2_000_000) {
    const added = b.length;
    const removed = a.length;
    return {
      path: filePath,
      unified: `--- a/${filePath}\n+++ b/${filePath}\n@@ coarse @@\n-${removed} lines\n+${added} lines\n`,
      added,
      removed,
      isNew,
    };
  }

  const lcs = buildLcs(a, b);
  const lines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  let k = 0;
  const hunk: string[] = [];

  const flush = (ai: number, bi: number) => {
    if (!hunk.length) {
      return;
    }
    lines.push(`@@ -${ai},${removed || 0} +${bi},${added || 0} @@`);
    lines.push(...hunk);
    hunk.length = 0;
  };

  let hunkStartA = 1;
  let hunkStartB = 1;
  let inHunk = false;

  while (i < a.length || j < b.length) {
    if (k < lcs.length && i < a.length && j < b.length && a[i] === lcs[k] && b[j] === lcs[k]) {
      if (inHunk) {
        hunk.push(` ${a[i]}`);
      }
      i++;
      j++;
      k++;
      continue;
    }
    if (!inHunk) {
      hunkStartA = i + 1;
      hunkStartB = j + 1;
      inHunk = true;
    }
    if (k < lcs.length && i < a.length && a[i] !== lcs[k]) {
      hunk.push(`-${a[i]}`);
      removed++;
      i++;
      continue;
    }
    if (k < lcs.length && j < b.length && b[j] !== lcs[k]) {
      hunk.push(`+${b[j]}`);
      added++;
      j++;
      continue;
    }
    if (i < a.length && k >= lcs.length) {
      hunk.push(`-${a[i]}`);
      removed++;
      i++;
      continue;
    }
    if (j < b.length && k >= lcs.length) {
      hunk.push(`+${b[j]}`);
      added++;
      j++;
      continue;
    }
    break;
  }

  if (hunk.length) {
    flush(hunkStartA, hunkStartB);
  } else if (isNew) {
    lines.push(`@@ -0,0 +1,${b.length} @@`);
    for (const line of b) {
      lines.push(`+${line}`);
      added++;
    }
  } else {
    lines.push("@@ unchanged @@");
  }

  return { path: filePath, unified: lines.join("\n"), added, removed, isNew };
}

function buildLcs(a: string[], b: string[]): string[] {
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  const seq: string[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      seq.push(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  seq.reverse();
  return seq;
}

export function formatDiffPreview(diffs: LineDiff[], maxChars = 3500): string {
  const parts = diffs.map(
    (d) =>
      `${d.path}: +${d.added}/-${d.removed}${d.isNew ? " (new)" : ""}\n${truncate(d.unified, 1200)}`
  );
  return truncate(parts.join("\n\n"), maxChars);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max) + "\n… (truncated)";
}
