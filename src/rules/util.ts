import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ParsedDoc } from "../types.js";

export interface CommandRef {
  command: string;
  line: number;
  column: number;
}

/**
 * Shell-ish commands mentioned in the document: inline code spans and the
 * lines of fenced code blocks (with a leading `$ ` prompt stripped), split on
 * `&&`, `||`, `;` and `|`.
 */
export function extractCommands(doc: ParsedDoc): CommandRef[] {
  const out: CommandRef[] = [];
  const push = (text: string, line: number, column: number) => {
    for (const part of text.split(/&&|\|\||;|\|/)) {
      const cmd = part.trim().replace(/^\$\s+/, "");
      if (cmd) out.push({ command: cmd, line, column });
    }
  };
  for (const span of doc.codeSpans) push(span.value, span.line, span.column);
  for (const block of doc.codeBlocks) {
    if (block.lang && !["", "sh", "bash", "shell", "zsh", "console", "terminal", "powershell", "ps1", "cmd"].includes(block.lang)) continue;
    block.body.split("\n").forEach((l, i) => {
      if (/^\s*#/.test(l)) return;
      push(l, block.line + i, 1);
    });
  }
  return out;
}

/** Walk up from `dir` to `root` (inclusive) and return the first directory containing `name`. */
export function findUp(name: string, dir: string, root: string): string | undefined {
  let current = dir;
  for (;;) {
    const candidate = path.join(current, name);
    if (existsSync(candidate)) return candidate;
    if (current === root || path.dirname(current) === current) return undefined;
    const rel = path.relative(root, current);
    if (rel.startsWith("..")) return undefined;
    current = path.dirname(current);
  }
}

export function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

export function pathExists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}
