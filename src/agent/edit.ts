import * as vscode from "vscode";
import * as path from "path";
import { chat } from "../llm/provider";
import { getConfig } from "../config";
import {
  WorkspaceContext,
  formatContextForPrompt,
  resolveWorkspacePath,
  isPathInsideWorkspace,
} from "./context";

export interface FileEdit {
  path: string;
  content: string;
  languageHint?: string;
}

export interface EditResult {
  instruction: string;
  edits: FileEdit[];
  applied: boolean;
  skipped: boolean;
  message: string;
}

export async function handleEdit(
  transcript: string,
  ctx: WorkspaceContext,
  payload: Record<string, unknown>
): Promise<EditResult> {
  const instruction =
    typeof payload.instruction === "string" && payload.instruction.trim()
      ? payload.instruction.trim()
      : transcript;

  const { content } = await chat([
    {
      role: "system",
      content: `You are a coding agent that proposes file edits for a VS Code workspace.
Return ONLY valid JSON (no markdown fences):
{
  "edits": [
    { "path": "relative/or/absolute/path", "content": "full new file contents", "languageHint": "optional" }
  ],
  "notes": "brief note"
}

Rules:
- Prefer relative paths from the workspace root.
- Provide FULL file content for each edited or created file.
- Only include files that must change.
- Stay inside the workspace.
- If you cannot safely edit, return { "edits": [], "notes": "reason" }.`,
    },
    {
      role: "user",
      content: `Instruction: ${instruction}\n\nOriginal utterance: ${transcript}\n\n${formatContextForPrompt(ctx)}`,
    },
  ]);

  const edits = parseEdits(content, ctx);
  if (edits.length === 0) {
    return {
      instruction,
      edits: [],
      applied: false,
      skipped: true,
      message: extractNotes(content) || "No file edits proposed.",
    };
  }

  const preview = edits
    .map((e) => `- ${e.path} (${e.content.length} chars)`)
    .join("\n");

  const config = getConfig();
  if (config.editConfirmMultiFile && edits.length > 1) {
    const choice = await vscode.window.showWarningMessage(
      `Apply ${edits.length} file edits?\n${preview}`,
      { modal: true },
      "Apply",
      "Cancel"
    );
    if (choice !== "Apply") {
      return {
        instruction,
        edits,
        applied: false,
        skipped: true,
        message: "User cancelled multi-file edit.",
      };
    }
  } else {
    const choice = await vscode.window.showInformationMessage(
      `Apply edit to ${edits.length} file(s)?\n${preview}`,
      { modal: true },
      "Apply",
      "Cancel"
    );
    if (choice !== "Apply") {
      return {
        instruction,
        edits,
        applied: false,
        skipped: true,
        message: "User cancelled edit.",
      };
    }
  }

  const wsEdit = new vscode.WorkspaceEdit();
  for (const edit of edits) {
    const abs = resolveWorkspacePath(edit.path, ctx);
    if (!isPathInsideWorkspace(abs, ctx)) {
      throw new Error(`Refusing to write outside workspace: ${abs}`);
    }
    const uri = vscode.Uri.file(abs);
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
    return {
      instruction,
      edits,
      applied: false,
      skipped: false,
      message: "WorkspaceEdit failed to apply.",
    };
  }

  // Open first edited file
  try {
    const first = vscode.Uri.file(resolveWorkspacePath(edits[0].path, ctx));
    const doc = await vscode.workspace.openTextDocument(first);
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch {
    // ignore
  }

  return {
    instruction,
    edits,
    applied: true,
    skipped: false,
    message: `Applied ${edits.length} file edit(s).`,
  };
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
    if (typeof rec.path !== "string" || typeof rec.content !== "string") {
      continue;
    }
    const abs = resolveWorkspacePath(rec.path, ctx);
    if (!isPathInsideWorkspace(abs, ctx) && ctx.workspaceFolders.length > 0) {
      continue;
    }
    results.push({
      path: path.normalize(rec.path),
      content: rec.content,
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
