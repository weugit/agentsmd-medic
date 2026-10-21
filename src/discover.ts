import { readdir } from "node:fs/promises";
import path from "node:path";

/** File names agents read. AGENTS.override.md is honoured by OpenAI Codex. */
export const AGENT_FILE_NAMES = ["AGENTS.md", "AGENTS.override.md"];

/** Directory names discovery and doctor never search. */
export const SKIP_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  ".hg",
  ".svn",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  "target",
]);

/**
 * Render a path with `/` separators for messages and reports.
 * `sep` defaults to the host separator. Pass `"\\"` (or `path.win32.sep`) to
 * normalize a Windows-style path on any operating system.
 */
export function toPosix(p: string, sep: string = path.sep): string {
  if (sep === "/") return p.replaceAll("\\", "/");
  return p.split(sep).join("/");
}

/** True when a `path.relative` result leaves its base, including another Windows drive. */
export function escapesRoot(rel: string): boolean {
  if (path.isAbsolute(rel)) return true;
  const posix = toPosix(rel);
  return posix === ".." || posix.startsWith("../");
}

function normalizeIgnore(pattern: string): string {
  return toPosix(pattern).replace(/^\.\//, "").replace(/\/+$/, "");
}

function isIgnored(rel: string, ignore: string[]): boolean {
  const posix = toPosix(rel);
  return ignore.some((pattern) => {
    const p = normalizeIgnore(pattern);
    if (!p) return false;
    if (!p.includes("/")) return posix.split("/").includes(p);
    return posix === p || posix.startsWith(`${p}/`);
  });
}

/** Recursively find AGENTS.md files (including nested ones) under `root`. */
export async function findAgentFiles(root: string, ignore: string[] = []): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORY_NAMES.has(entry.name) || isIgnored(rel, ignore)) continue;
        await walk(abs);
      } else if (entry.isFile() && AGENT_FILE_NAMES.includes(entry.name) && !isIgnored(rel, ignore)) {
        found.push(abs);
      }
    }
  }
  await walk(root);
  return found.sort((a, b) => {
    const da = a.split(path.sep).length;
    const db = b.split(path.sep).length;
    return da - db || a.localeCompare(b);
  });
}
