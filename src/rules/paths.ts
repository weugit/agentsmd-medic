import path from "node:path";
import type { Rule } from "../types.js";
import { pathExists } from "./util.js";

const EXTENSIONS = [
  ".md",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".sh",
  ".css",
  ".scss",
  ".html",
  ".txt",
  ".lock",
];

function hasKnownExtension(value: string): boolean {
  const lower = value.toLowerCase();
  return EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Skip URLs, globs, flags, and other inline code that only looks path-like. */
function isSkippable(value: string): boolean {
  if (!value || /\s/.test(value)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || /^www\./i.test(value)) return true;
  if (value.includes("*") || value.includes("?") || value.includes("{") || value.includes("[")) return true;
  if (/^[-~/$]/.test(value)) return true;
  if (/[<>()=:@]/.test(value)) return true;
  if (/^@[^/]+\//.test(value)) return true;
  return false;
}

function firstSegmentExists(value: string, dir: string, root: string): boolean {
  const segment = value.split("/")[0] ?? "";
  if (!segment) return false;
  if (segment === "." || segment === "..") return true;
  return pathExists(path.join(dir, segment)) || pathExists(path.join(root, segment));
}

function looksLikeRepoPath(value: string, dir: string, root: string): boolean {
  if (isSkippable(value)) return false;
  const hasSlash = value.includes("/");
  const hasExt = hasKnownExtension(value);
  if (!hasSlash && !hasExt) return false;
  if (hasSlash && !hasExt && !value.endsWith("/") && !firstSegmentExists(value, dir, root)) return false;
  return true;
}

export const noMissingPaths: Rule = {
  id: "no-missing-paths",
  description: "File paths in inline code should exist in the repository.",
  defaultSeverity: "warn",
  check({ doc, file, root }) {
    const dir = path.dirname(file);
    const out = [];
    for (const span of doc.codeSpans) {
      const value = span.value;
      if (!looksLikeRepoPath(value, dir, root)) continue;
      const fromFile = path.resolve(dir, value);
      if (pathExists(fromFile) || pathExists(path.resolve(root, value))) continue;
      out.push({ message: `Referenced path \`${value}\` does not exist`, line: span.line, column: span.column });
    }
    return out;
  },
};
