import * as fs from "fs";
import * as path from "path";

const DEFAULT_EXCLUDES = new Set([
  "node_modules",
  ".git",
  "out",
  "dist",
  ".venv",
  "venv",
  "__pycache__",
  ".cursor",
  "coverage",
  ".next",
  "build",
]);

const SECRET_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|secret|token|password|passwd|authorization)\s*[:=]\s*["']?[^\s"']+/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
];

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export interface ReadFileResult {
  path: string;
  content: string;
  truncated: boolean;
}

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

export function shouldSkipDir(name: string, extraExcludes: string[] = []): boolean {
  if (name.startsWith(".") && name !== ".") {
    if (name === ".github" || name === ".vscode") {
      return false;
    }
    return true;
  }
  if (DEFAULT_EXCLUDES.has(name)) {
    return true;
  }
  return extraExcludes.includes(name);
}

export function searchWorkspace(
  roots: string[],
  query: string,
  options?: { maxHits?: number; maxFileBytes?: number; exclude?: string[] }
): SearchHit[] {
  const maxHits = options?.maxHits ?? 20;
  const maxFileBytes = options?.maxFileBytes ?? 200_000;
  const exclude = options?.exclude ?? [];
  const needle = query.trim().toLowerCase();
  if (!needle || !roots.length) {
    return [];
  }

  const hits: SearchHit[] = [];

  const walk = (dir: string) => {
    if (hits.length >= maxHits) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hits.length >= maxHits) {
        return;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name, exclude)) {
          walk(full);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|mp3|mp4|wav|zip|gz|7z|pdf|exe|dll|so|dylib)$/i.test(entry.name)) {
        continue;
      }
      let content: string;
      try {
        const stat = fs.statSync(full);
        if (stat.size > maxFileBytes) {
          continue;
        }
        content = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      if (content.includes("\0")) {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          hits.push({
            path: full,
            line: i + 1,
            text: redactSecrets(lines[i].trim()).slice(0, 240),
          });
          if (hits.length >= maxHits) {
            return;
          }
        }
      }
    }
  };

  for (const root of roots) {
    walk(root);
  }
  return hits;
}

export function readWorkspaceFile(
  filePath: string,
  options?: { maxChars?: number }
): ReadFileResult {
  const maxChars = options?.maxChars ?? 8000;
  const raw = fs.readFileSync(filePath, "utf8");
  const redacted = redactSecrets(raw);
  if (redacted.length <= maxChars) {
    return { path: filePath, content: redacted, truncated: false };
  }
  return {
    path: filePath,
    content: redacted.slice(0, maxChars) + "\n… (truncated)",
    truncated: true,
  };
}

export function extractSearchTerms(text: string): string[] {
  const stop = new Set([
    "the", "a", "an", "and", "or", "to", "of", "in", "for", "on", "with",
    "please", "can", "you", "me", "this", "that", "file", "code", "add",
    "update", "change", "fix", "create", "make", "how", "what", "where",
    "por", "favor", "uma", "um", "de", "da", "do", "que", "para", "com",
  ]);
  const tokens = text
    .split(/[^A-Za-z0-9_./-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t.toLowerCase()));
  const unique: string[] = [];
  for (const t of tokens) {
    if (!unique.some((u) => u.toLowerCase() === t.toLowerCase())) {
      unique.push(t);
    }
    if (unique.length >= 5) {
      break;
    }
  }
  return unique;
}
