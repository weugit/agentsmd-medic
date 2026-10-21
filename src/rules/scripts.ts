import { readFileSync } from "node:fs";
import path from "node:path";
import { escapesRoot, toPosix } from "../discover.js";
import type { Rule } from "../types.js";
import { extractCommands, findUp, readJson } from "./util.js";

const BUILTINS = new Set([
  "install",
  "i",
  "add",
  "remove",
  "rm",
  "up",
  "upgrade",
  "update",
  "dlx",
  "exec",
  "create",
  "init",
  "why",
  "link",
  "unlink",
  "publish",
  "pack",
  "audit",
  "outdated",
  "list",
  "ls",
  "info",
  "config",
  "store",
  "import",
  "rebuild",
  "prune",
  "help",
  "version",
  "set",
  "workspace",
  "workspaces",
  "global",
  "cache",
  "licenses",
  "plugin",
  "node",
  "env",
  "patch",
  "dedupe",
  "setup",
  "fetch",
  "deploy",
  "start",
]);

const SCOPE_EXACT = new Set(["--filter", "-F", "-w", "--workspace", "--workspaces", "-r", "--recursive", "--prefix", "-C"]);

const MAKEFILE_NAMES = ["Makefile", "makefile", "GNUmakefile"];

const MAKE_TARGET = /^([^\s:#=][^:=]*)::?(?!=)/;

const MAKE_LONG_ARG = new Set([
  "--directory",
  "--file",
  "--makefile",
  "--include-dir",
  "--old-file",
  "--assume-old",
  "--what-if",
  "--new-file",
  "--assume-new",
  "--eval",
]);

function unquote(token: string): string {
  if (token.length >= 2) {
    const q = token[0];
    if ((q === '"' || q === "'") && token.endsWith(q)) return token.slice(1, -1);
  }
  return token;
}

function mentionsExternalScope(tokens: string[]): boolean {
  for (const t of tokens) {
    if (SCOPE_EXACT.has(t)) return true;
    if (/^(?:--filter|--workspace|--workspaces|--prefix|--recursive)=/.test(t)) return true;
    if (/^-[CF]\S/.test(t) || /^-w\S/.test(t)) return true;
  }
  return false;
}

/** Positional words, with flags and leading environment assignments removed. */
function wordsOf(tokens: string[]): string[] {
  const words: string[] = [];
  for (const raw of tokens) {
    if (raw === "--") break;
    if (raw.startsWith("-")) continue;
    if (words.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) continue;
    words.push(unquote(raw));
  }
  return words;
}

function detectScript(tokens: string[]): string | undefined {
  const words = wordsOf(tokens);
  const tool = words[0];
  const sub = words[1];
  if (!tool || !sub) return undefined;
  if (tool === "npm" && (sub === "run" || sub === "run-script")) return words[2];
  if (tool === "npm" && (sub === "test" || sub === "t")) return "test";
  if ((tool === "pnpm" || tool === "yarn" || tool === "bun") && sub === "run") return words[2];
  if ((tool === "pnpm" || tool === "yarn") && !BUILTINS.has(sub)) return sub;
  return undefined;
}

function makeTargetsOf(tokens: string[]): string[] {
  let start = 0;
  while (start < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[start] ?? "")) start += 1;
  if (unquote(tokens[start] ?? "") !== "make") return [];
  const targets: string[] = [];
  for (let i = start + 1; i < tokens.length; i++) {
    const t = unquote(tokens[i] ?? "");
    if (!t) continue;
    if (t === "--") {
      for (let j = i + 1; j < tokens.length; j++) {
        const rest = unquote(tokens[j] ?? "");
        if (rest && !rest.startsWith("-") && !rest.includes("=")) targets.push(rest);
      }
      break;
    }
    if (t.startsWith("--")) {
      const eq = t.indexOf("=");
      const name = eq === -1 ? t : t.slice(0, eq);
      if (eq === -1 && MAKE_LONG_ARG.has(name)) i += 1;
      else if (name === "--jobs" && eq === -1 && /^\d+$/.test(tokens[i + 1] ?? "")) i += 1;
      continue;
    }
    if (t.startsWith("-")) {
      const body = t.slice(1);
      if (body.length === 1 && "CfIoW".includes(body)) i += 1;
      else if (body === "j" && /^\d+$/.test(tokens[i + 1] ?? "")) i += 1;
      continue;
    }
    if (t.includes("=")) continue;
    targets.push(t);
  }
  return targets;
}

function scriptNames(pkgFile: string): Set<string> | undefined {
  const data = readJson(pkgFile);
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  const scripts = (data as { scripts?: unknown }).scripts;
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) return new Set();
  return new Set(Object.keys(scripts));
}

function findMakefile(dir: string, root: string): string | undefined {
  const hits = MAKEFILE_NAMES.map((name) => findUp(name, dir, root)).filter((p): p is string => p !== undefined);
  if (hits.length === 0) return undefined;
  hits.sort((a, b) => {
    const depth = (file: string) => {
      const rel = path.relative(dir, path.dirname(file));
      return rel === "" ? 0 : rel.split(path.sep).length;
    };
    const d = depth(a) - depth(b);
    if (d !== 0) return d;
    return MAKEFILE_NAMES.indexOf(path.basename(a)) - MAKEFILE_NAMES.indexOf(path.basename(b));
  });
  return hits[0];
}

function makefileTargets(file: string): Set<string> | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = MAKE_TARGET.exec(line);
    const captured = match?.[1];
    if (!captured) continue;
    for (const name of captured.split(/\s+/)) {
      if (name) names.add(name);
    }
  }
  return names;
}

function displayPath(root: string, file: string): string {
  const rel = path.relative(root, file);
  return toPosix(escapesRoot(rel) ? file : rel);
}

export const noMissingScripts: Rule = {
  id: "no-missing-scripts",
  description: "Package scripts and Make targets mentioned in commands should exist.",
  defaultSeverity: "warn",
  check({ doc, file, root }) {
    const dir = path.dirname(file);
    const pkgFile = findUp("package.json", dir, root);
    const scripts = pkgFile ? scriptNames(pkgFile) : undefined;
    const makefile = findMakefile(dir, root);
    const targets = makefile ? makefileTargets(makefile) : undefined;
    const out = [];

    for (const cmd of extractCommands(doc)) {
      const tokens = cmd.command.split(/\s+/).filter(Boolean);
      if (tokens.length === 0 || mentionsExternalScope(tokens)) continue;

      if (scripts && pkgFile) {
        const script = detectScript(tokens);
        if (script && !scripts.has(script)) {
          out.push({
            message: `Script \`${script}\` is not defined in ${displayPath(root, pkgFile)}.`,
            line: cmd.line,
            column: cmd.column,
          });
        }
      }

      if (targets && makefile) {
        for (const target of makeTargetsOf(tokens)) {
          if (targets.has(target)) continue;
          out.push({
            message: `Make target \`${target}\` is not defined in ${displayPath(root, makefile)}.`,
            line: cmd.line,
            column: cmd.column,
          });
        }
      }
    }
    return out;
  },
};
