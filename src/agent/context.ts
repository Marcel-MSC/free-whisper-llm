import * as vscode from "vscode";
import * as path from "path";
import {
  extractSearchTerms,
  readWorkspaceFile,
  redactSecrets,
  searchWorkspace,
  SearchHit,
} from "./search";
import {
  canonicalizePath,
  isPathInsideRoots,
  resolveUnderRoots,
} from "./pathSafety";
import { hasFeature } from "../license/entitlements";

export interface WorkspaceContext {
  workspaceFolders: string[];
  /** Root used for relative path resolution (selected workspace). */
  preferredRoot?: string;
  activeFile?: string;
  languageId?: string;
  selection?: string;
  activeFileExcerpt?: string;
  shellKind: "bash" | "powershell" | "cmd";
  searchHits?: SearchHit[];
  relatedFiles?: Array<{ path: string; content: string; truncated: boolean }>;
  proContext: boolean;
}

export interface GatherContextOptions {
  preferredRoot?: string;
  onSearch?: () => void;
}

const MAX_EXCERPT = 6000;
const MAX_SELECTION = 4000;

export async function gatherContext(
  transcript?: string,
  options?: GatherContextOptions
): Promise<WorkspaceContext> {
  const folders =
    vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
  const preferredRoot = pickPreferredRoot(folders, options?.preferredRoot);
  const editor = vscode.window.activeTextEditor;
  const shellKind = detectShell();
  const proContext = await hasFeature("codebaseSearch");

  let base: WorkspaceContext = {
    workspaceFolders: folders,
    preferredRoot,
    shellKind,
    proContext,
  };

  if (editor) {
    const doc = editor.document;
    const selection = editor.selection.isEmpty
      ? undefined
      : redactSecrets(doc.getText(editor.selection).slice(0, MAX_SELECTION));

    let activeFileExcerpt: string | undefined;
    const full = redactSecrets(doc.getText());
    if (full.length <= MAX_EXCERPT) {
      activeFileExcerpt = full;
    } else {
      const mid = editor.selection.active.line;
      const start = Math.max(0, mid - 80);
      const end = Math.min(doc.lineCount - 1, mid + 80);
      activeFileExcerpt =
        `... (lines ${start + 1}-${end + 1}) ...\n` +
        redactSecrets(
          doc.getText(new vscode.Range(start, 0, end, doc.lineAt(end).text.length))
        );
    }

    base = {
      ...base,
      activeFile: doc.uri.fsPath,
      languageId: doc.languageId,
      selection,
      activeFileExcerpt,
    };
  }

  if (proContext && transcript && folders.length) {
    options?.onSearch?.();
    const terms = extractSearchTerms(transcript);
    const hits: SearchHit[] = [];
    for (const term of terms.slice(0, 3)) {
      hits.push(...searchWorkspace(folders, term, { maxHits: 8 }));
      if (hits.length >= 16) {
        break;
      }
    }
    const seen = new Set<string>();
    const unique = hits.filter((h) => {
      const k = `${h.path}:${h.line}`;
      if (seen.has(k)) {
        return false;
      }
      seen.add(k);
      return true;
    });
    base.searchHits = unique.slice(0, 16);

    const relatedPaths = [...new Set(unique.map((h) => h.path))].slice(0, 3);
    base.relatedFiles = relatedPaths
      .filter((p) => p !== base.activeFile)
      .map((p) => {
        try {
          return readWorkspaceFile(p, { maxChars: 4000 });
        } catch {
          return undefined;
        }
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
  }

  return base;
}

function pickPreferredRoot(
  folders: string[],
  preferred?: string
): string | undefined {
  if (!folders.length) {
    return undefined;
  }
  if (preferred) {
    const preferredCanon = canonicalizePath(preferred);
    const match = folders.find((f) => canonicalizePath(f) === preferredCanon);
    if (match) {
      return match;
    }
  }
  return folders[0];
}

export function detectShell(): "bash" | "powershell" | "cmd" {
  const profile = vscode.env.shell.toLowerCase();
  if (profile.includes("powershell") || profile.includes("pwsh")) {
    return "powershell";
  }
  if (
    profile.includes("cmd.exe") ||
    profile.endsWith("\\cmd") ||
    profile.endsWith("/cmd")
  ) {
    return "cmd";
  }
  return "bash";
}

export function formatContextForPrompt(ctx: WorkspaceContext): string {
  const lines: string[] = [];
  lines.push(`Shell: ${ctx.shellKind}`);
  if (ctx.preferredRoot) {
    lines.push(`Selected workspace root: ${ctx.preferredRoot}`);
  }
  if (ctx.workspaceFolders.length) {
    lines.push(
      `Workspace folders:\n${ctx.workspaceFolders.map((p) => `- ${p}`).join("\n")}`
    );
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
  if (ctx.searchHits?.length) {
    lines.push(
      "Workspace search hits:\n" +
        ctx.searchHits
          .map((h) => `- ${h.path}:${h.line}: ${h.text}`)
          .join("\n")
    );
  }
  if (ctx.relatedFiles?.length) {
    for (const f of ctx.relatedFiles) {
      lines.push(
        `Related file ${f.path}${f.truncated ? " (truncated)" : ""}:\n\`\`\`\n${f.content}\n\`\`\``
      );
    }
  }
  if (!ctx.proContext) {
    lines.push(
      "Note: Free tier context is limited to the active file. Pro unlocks workspace search."
    );
  }
  return lines.join("\n\n");
}

export function resolveWorkspacePath(
  relativeOrAbsolute: string,
  ctx: WorkspaceContext
): string {
  return resolveUnderRoots(
    relativeOrAbsolute,
    ctx.workspaceFolders,
    ctx.preferredRoot
  );
}

export function isPathInsideWorkspace(
  filePath: string,
  ctx: WorkspaceContext
): boolean {
  return isPathInsideRoots(filePath, ctx.workspaceFolders);
}

export { canonicalizePath };
