import * as path from "path";
import * as fs from "fs";

/**
 * Resolve a path and, when possible, realpath it to defeat symlink escapes.
 */
export function canonicalizePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    // File may not exist yet (create). Canonicalize existing parents.
    try {
      const dir = path.dirname(resolved);
      const base = path.basename(resolved);
      const realDir = fs.realpathSync.native(dir);
      return path.join(realDir, base);
    } catch {
      return resolved;
    }
  }
}

export function isPathInsideRoots(filePath: string, roots: string[]): boolean {
  const normalized = canonicalizePath(filePath);
  return roots.some((folder) => {
    const root = canonicalizePath(folder);
    return normalized === root || normalized.startsWith(root + path.sep);
  });
}

export function resolveUnderRoots(
  relativeOrAbsolute: string,
  roots: string[]
): string {
  if (path.isAbsolute(relativeOrAbsolute)) {
    return canonicalizePath(relativeOrAbsolute);
  }
  if (!roots.length) {
    throw new Error("No workspace folder open.");
  }
  return canonicalizePath(path.join(roots[0], relativeOrAbsolute));
}
