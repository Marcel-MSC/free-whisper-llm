import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { chat } from "../llm/provider";
import { getConfig } from "../config";
import {
  WorkspaceContext,
  formatContextForPrompt,
  resolveWorkspacePath,
  isPathInsideWorkspace,
  canonicalizePath,
} from "./context";
import { formatDiffPreview, unifiedDiff, LineDiff } from "./diff";
import { hasFeature } from "../license/entitlements";
import { track } from "../analytics";

export interface FileEdit {
  path: string;
  content: string;
  languageHint?: string;
  /** Optional search/replace patch preferred over full rewrite. */
  patches?: Array<{ search: string; replace: string }>;
}

export interface EditResult {
  instruction: string;
  edits: FileEdit[];
  diffs: LineDiff[];
  applied: boolean;
  skipped: boolean;
  message: string;
}

export async function handleEdit(
  transcript: string,
  ctx: WorkspaceContext,
  payload: Record<string, unknown>,
  signal?: AbortSignal
): Promise<EditResult> {
  const instruction =
    typeof payload.instruction === "string" && payload.instruction.trim()
      ? payload.instruction.trim()
      : transcript;

  const allowMulti = await hasFeature("multiFilePatches");

  const { content } = await chat(
    [
      {
        role: "system",
        content: `You are a coding agent that proposes file edits for a VS Code workspace.
Return ONLY valid JSON (no markdown fences):
{
  "edits": [
    {
      "path": "relative/or/absolute/path",
      "content": "full new file contents (required for new files; optional if patches provided)",
      "patches": [{ "search": "exact old text", "replace": "new text" }],
      "languageHint": "optional"
    }
  ],
  "notes": "brief note"
}

Rules:
- Prefer relative paths from the workspace root.
- Prefer bounded "patches" (exact search/replace) over full-file "content" when editing existing files.
- Provide FULL "content" only for new files or when a rewrite is unavoidable.
- Only include files that must change.
- Stay inside the workspace.
- ${allowMulti ? "Multi-file edits are allowed." : "Free tier: edit at most ONE file."}
- If you cannot safely edit, return { "edits": [], "notes": "reason" }.`,
      },
      {
        role: "user",
        content: `Instruction: ${instruction}\n\nOriginal utterance: ${transcript}\n\n${formatContextForPrompt(ctx)}`,
      },
    ],
    { signal }
  );

  let edits = parseEdits(content, ctx);
  if (!allowMulti && edits.length > 1) {
    edits = edits.slice(0, 1);
  }

  if (edits.length === 0) {
    return {
      instruction,
      edits: [],
      diffs: [],
      applied: false,
      skipped: true,
      message: extractNotes(content) || "No file edits proposed.",
    };
  }

  // Materialize patch-based edits into full content + collect diffs
  const materialized: FileEdit[] = [];
  const diffs: LineDiff[] = [];
  const dirtyConflicts: string[] = [];

  for (const edit of edits) {
    const abs = canonicalizePath(resolveWorkspacePath(edit.path, ctx));
    if (!isPathInsideWorkspace(abs, ctx)) {
      throw new Error(`Refusing to write outside workspace: ${abs}`);
    }

    let before = "";
    let exists = false;
    try {
      before = await fs.promises.readFile(abs, "utf8");
      exists = true;
    } catch {
      exists = false;
    }

    const openDoc = vscode.workspace.textDocuments.find(
      (d) => canonicalizePath(d.uri.fsPath) === abs
    );
    if (openDoc?.isDirty) {
      dirtyConflicts.push(edit.path);
      before = openDoc.getText();
    }

    let after = edit.content;
    if (edit.patches?.length) {
      after = applyPatches(before, edit.patches);
    } else if (!exists && !edit.content) {
      continue;
    } else if (exists && !edit.content && !edit.patches?.length) {
      continue;
    } else if (!after && exists) {
      after = before;
    }

    materialized.push({ ...edit, path: abs, content: after });
    diffs.push(
      unifiedDiff(path.relative(ctx.workspaceFolders[0] || "", abs) || abs, before, after)
    );
  }

  if (!materialized.length) {
    return {
      instruction,
      edits: [],
      diffs: [],
      applied: false,
      skipped: true,
      message: "Edits could not be materialized (missing content/patches).",
    };
  }

  if (dirtyConflicts.length) {
    const choice = await vscode.window.showWarningMessage(
      `These files have unsaved changes and may conflict:\n${dirtyConflicts.join("\n")}\nApply anyway using the buffer contents as base?`,
      { modal: true },
      "Apply",
      "Cancel"
    );
    if (choice !== "Apply") {
      await track("edit_reject", { reason: "dirty" });
      return {
        instruction,
        edits: materialized,
        diffs,
        applied: false,
        skipped: true,
        message: "User cancelled due to dirty-buffer conflict.",
      };
    }
  }

  const preview = formatDiffPreview(diffs);
  const config = getConfig();
  const title =
    materialized.length > 1
      ? `Apply ${materialized.length} file edits?`
      : `Apply edit to ${path.basename(materialized[0].path)}?`;

  const alwaysConfirm = config.editConfirmMultiFile || materialized.length === 1;
  if (alwaysConfirm) {
    const choice = await vscode.window.showWarningMessage(
      `${title}\n\n${preview}`,
      { modal: true },
      "Apply",
      "Cancel"
    );
    if (choice !== "Apply") {
      await track("edit_reject", { files: materialized.length });
      return {
        instruction,
        edits: materialized,
        diffs,
        applied: false,
        skipped: true,
        message: "User cancelled edit after reviewing diff.",
      };
    }
  }

  const wsEdit = new vscode.WorkspaceEdit();
  for (const edit of materialized) {
    const uri = vscode.Uri.file(edit.path);
    let exists = true;
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      exists = false;
    }

    if (exists) {
      const doc = await vscode.workspace.openTextDocument(uri);
      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(doc.getText().length)
      );
      wsEdit.replace(uri, fullRange, edit.content);
    } else {
      wsEdit.createFile(uri, {
        ignoreIfExists: true,
        contents: Buffer.from(edit.content, "utf8"),
      });
    }
  }

  const ok = await vscode.workspace.applyEdit(wsEdit);
  if (!ok) {
    await track("edit_reject", { reason: "apply_failed" });
    return {
      instruction,
      edits: materialized,
      diffs,
      applied: false,
      skipped: false,
      message: "WorkspaceEdit failed to apply.",
    };
  }

  try {
    const first = vscode.Uri.file(materialized[0].path);
    const doc = await vscode.workspace.openTextDocument(first);
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch {
    // ignore
  }

  await track("edit_accept", { files: materialized.length });
  return {
    instruction,
    edits: materialized,
    diffs,
    applied: true,
    skipped: false,
    message: `Applied ${materialized.length} file edit(s). Use Undo (Ctrl/Cmd+Z) in each file if needed.`,
  };
}

function applyPatches(
  before: string,
  patches: Array<{ search: string; replace: string }>
): string {
  let result = before;
  for (const p of patches) {
    if (!p.search) {
      continue;
    }
    if (!result.includes(p.search)) {
      throw new Error(`Patch search text not found in file.`);
    }
    result = result.replace(p.search, p.replace);
  }
  return result;
}

function parseEdits(content: string, ctx: WorkspaceContext): FileEdit[] {
  const cleaned = stripFences(content);
  let data: { edits?: unknown };
  try {
    data = JSON.parse(cleaned) as { edits?: unknown };
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      return [];
    }
    try {
      data = JSON.parse(match[0]) as { edits?: unknown };
    } catch {
      return [];
    }
  }

  if (!Array.isArray(data.edits)) {
    return [];
  }

  const results: FileEdit[] = [];
  for (const item of data.edits) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const rec = item as Record<string, unknown>;
    if (typeof rec.path !== "string") {
      continue;
    }
    const hasContent = typeof rec.content === "string";
    const patches = Array.isArray(rec.patches)
      ? rec.patches
          .filter(
            (p): p is { search: string; replace: string } =>
              !!p &&
              typeof p === "object" &&
              typeof (p as { search?: unknown }).search === "string" &&
              typeof (p as { replace?: unknown }).replace === "string"
          )
          .map((p) => ({ search: p.search, replace: p.replace }))
      : undefined;
    if (!hasContent && !patches?.length) {
      continue;
    }
    const abs = resolveWorkspacePath(rec.path, ctx);
    if (!isPathInsideWorkspace(abs, ctx) && ctx.workspaceFolders.length > 0) {
      continue;
    }
    results.push({
      path: path.normalize(rec.path),
      content: hasContent ? (rec.content as string) : "",
      patches,
      languageHint: typeof rec.languageHint === "string" ? rec.languageHint : undefined,
    });
  }
  return results;
}

function extractNotes(content: string): string {
  try {
    const data = JSON.parse(stripFences(content)) as { notes?: string };
    return typeof data.notes === "string" ? data.notes : "";
  } catch {
    return "";
  }
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : trimmed;
}
