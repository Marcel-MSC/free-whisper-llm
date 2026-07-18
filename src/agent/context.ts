import * as vscode from "vscode";
import * as path from "path";

export interface WorkspaceContext {
  workspaceFolders: string[];
  activeFile?: string;
  languageId?: string;
  selection?: string;
  activeFileExcerpt?: string;
  shellKind: "bash" | "powershell" | "cmd";
}

const MAX_EXCERPT = 6000;
const MAX_SELECTION = 4000;

export async function gatherContext(): Promise<WorkspaceContext> {
  const folders = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
  const editor = vscode.window.activeTextEditor;
  const shellKind = detectShell();

  if (!editor) {
    return { workspaceFolders: folders, shellKind };
  }

  const doc = editor.document;
  const selection = editor.selection.isEmpty
    ? undefined
    : doc.getText(editor.selection).slice(0, MAX_SELECTION);

  let activeFileExcerpt: string | undefined;
  const full = doc.getText();
  if (full.length <= MAX_EXCERPT) {
    activeFileExcerpt = full;
  } else {
    const mid = editor.selection.active.line;
    const start = Math.max(0, mid - 80);
    const end = Math.min(doc.lineCount - 1, mid + 80);
    activeFileExcerpt =
      `... (lines ${start + 1}-${end + 1}) ...\n` +
      doc.getText(new vscode.Range(start, 0, end, doc.lineAt(end).text.length));
  }

  return {
    workspaceFolders: folders,
    activeFile: doc.uri.fsPath,
    languageId: doc.languageId,
    selection,
    activeFileExcerpt,
    shellKind,
  };
}

export function detectShell(): "bash" | "powershell" | "cmd" {
  const profile = vscode.env.shell.toLowerCase();
  if (profile.includes("powershell") || profile.includes("pwsh")) {
    return "powershell";
  }
  if (profile.includes("cmd.exe") || profile.endsWith("\\cmd") || profile.endsWith("/cmd")) {
    return "cmd";
  }
  return "bash";
}

export function formatContextForPrompt(ctx: WorkspaceContext): string {
  const lines: string[] = [];
  lines.push(`Shell: ${ctx.shellKind}`);
  if (ctx.workspaceFolders.length) {
    lines.push(`Workspace folders:\n${ctx.workspaceFolders.map((p) => `- ${p}`).join("\n")}`);
  }
  if (ctx.activeFile) {
    lines.push(`Active file: ${ctx.activeFile} (${ctx.languageId ?? "unknown"})`);
  }
  if (ctx.selection) {
    lines.push(`Current selection:\n\`\`\`\n${ctx.selection}\n\`\`\``);
  }
  if (ctx.activeFileExcerpt) {
    lines.push(`Active file excerpt:\n\`\`\`\n${ctx.activeFileExcerpt}\n\`\`\``);
  }
  return lines.join("\n\n");
}

export function resolveWorkspacePath(relativeOrAbsolute: string, ctx: WorkspaceContext): string {
  if (path.isAbsolute(relativeOrAbsolute)) {
    return relativeOrAbsolute;
  }
  const root = ctx.workspaceFolders[0];
  if (!root) {
    throw new Error("No workspace folder open.");
  }
  return path.join(root, relativeOrAbsolute);
}

export function isPathInsideWorkspace(filePath: string, ctx: WorkspaceContext): boolean {
  const normalized = path.resolve(filePath);
  return ctx.workspaceFolders.some((folder) => {
    const root = path.resolve(folder);
    return normalized === root || normalized.startsWith(root + path.sep);
  });
}
