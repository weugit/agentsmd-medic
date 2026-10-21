import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { ConfigError, loadConfig } from "./config.js";
import { findAgentFiles, toPosix } from "./discover.js";
import { parseMarkdown } from "./markdown.js";
import { rules } from "./rules/index.js";
import type { Config, Diagnostic, FileResult, LintResult, ParsedDoc, Rule, RuleSetting, Severity } from "./types.js";

export interface LintTextOptions {
  /** Absolute path of the file being linted. */
  file: string;
  /** Absolute path of the lint root. */
  root: string;
  config: Config;
}

export interface LintOptions {
  cwd: string;
  /** Files or directories. Defaults to ["."]. */
  paths?: string[];
  /** Explicit config file. Omit to search `cwd` for a default config. */
  configPath?: string;
}

interface Disables {
  /** Every rule is disabled for the whole file. */
  fileAll: boolean;
  /** Rule ids disabled for the whole file. */
  fileRules: Set<string>;
  /** Rule ids (or all rules) disabled on a specific 1-based line. */
  lineRules: Map<number, Set<string> | "all">;
}

const KNOWN_RULE_IDS = (): string[] => rules.map((rule) => rule.id);

function assertKnownRules(config: Config): void {
  const known = new Set(KNOWN_RULE_IDS());
  const unknown = Object.keys(config.rules).filter((id) => !known.has(id));
  if (unknown.length === 0) return;
  const quoted = unknown.map((id) => `"${id}"`).join(", ");
  const label = unknown.length === 1 ? `Unknown rule ${quoted}` : `Unknown rules ${quoted}`;
  const valid = [...known].sort().join(", ");
  throw new ConfigError(`${label}. Valid rule ids: ${valid}`);
}

function settingFor(rule: Rule, config: Config): RuleSetting {
  return config.rules[rule.id] ?? rule.defaultSeverity;
}

/** Rule list inside a disable comment. An empty list disables every rule. */
function parseRuleList(raw: string): Set<string> | "all" {
  const trimmed = raw.trim();
  if (!trimmed) return "all";
  const ids = new Set<string>();
  for (const part of trimmed.split(",")) {
    const id = part.trim();
    if (id) ids.add(id);
  }
  return ids;
}

function mergeDisable(map: Map<number, Set<string> | "all">, line: number, which: Set<string> | "all"): void {
  const prev = map.get(line);
  if (which === "all" || prev === "all") {
    map.set(line, "all");
    return;
  }
  if (!prev) {
    map.set(line, new Set(which));
    return;
  }
  for (const id of which) prev.add(id);
}

function nextNonBlankLine(lines: string[], index: number): number | undefined {
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && line.trim() !== "") return i + 1;
  }
  return undefined;
}

/**
 * `<!-- agentsmd-medic-disable [rules] -->` covers the whole file.
 * `<!-- agentsmd-medic-disable-next-line [rules] -->` covers the next non-blank line.
 * Comments inside fenced code are ignored so examples do not silence real findings.
 */
function parseDisables(doc: ParsedDoc): Disables {
  const fileRules = new Set<string>();
  let fileAll = false;
  const lineRules = new Map<number, Set<string> | "all">();
  const directive = /<!--\s*(agentsmd-medic-disable(?:-next-line)?)(?=\s|-->)\s*([^>]*?)-->/g;

  doc.lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (doc.codeBlockLines.has(lineNo)) return;
    directive.lastIndex = 0;
    for (const match of line.matchAll(directive)) {
      const kind = match[1] ?? "";
      const which = parseRuleList(match[2] ?? "");
      if (kind.endsWith("-next-line")) {
        const target = nextNonBlankLine(doc.lines, index);
        if (target !== undefined) mergeDisable(lineRules, target, which);
      } else if (which === "all") {
        fileAll = true;
      } else {
        for (const id of which) fileRules.add(id);
      }
    }
  });

  return { fileAll, fileRules, lineRules };
}

function suppressed(disables: Disables, ruleId: string, line: number): boolean {
  if (disables.fileAll || disables.fileRules.has(ruleId)) return true;
  const onLine = disables.lineRules.get(line);
  return onLine === "all" || (onLine?.has(ruleId) ?? false);
}

function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  return a.line - b.line || a.column - b.column || (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0);
}

/** Lint one document. Throws ConfigError when `config.rules` names an unknown rule. */
export function lintText(source: string, options: LintTextOptions): Diagnostic[] {
  const { file, root, config } = options;
  assertKnownRules(config);
  const doc = parseMarkdown(source);
  const disables = parseDisables(doc);
  const diagnostics: Diagnostic[] = [];

  for (const rule of rules) {
    const setting = settingFor(rule, config);
    if (setting === "off") continue;
    if (disables.fileAll || disables.fileRules.has(rule.id)) continue;
    const severity: Severity = setting;
    for (const item of rule.check({ file, root, doc, config })) {
      if (suppressed(disables, rule.id, item.line)) continue;
      diagnostics.push({ ...item, ruleId: rule.id, severity });
    }
  }

  diagnostics.sort(compareDiagnostics);
  return diagnostics;
}

function errorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err && typeof err.code === "string") return err.code;
  return undefined;
}

/** Read each file as UTF-8 and lint it. Paths are resolved to absolute paths. */
export async function lintFiles(files: string[], root: string, config: Config): Promise<LintResult> {
  assertKnownRules(config);
  const results: FileResult[] = [];
  let errorCount = 0;
  let warningCount = 0;

  for (const file of files) {
    const absolute = path.resolve(file);
    const source = await readFile(absolute, "utf8");
    const diagnostics = lintText(source, { file: absolute, root, config });
    let errors = 0;
    let warnings = 0;
    for (const diagnostic of diagnostics) {
      if (diagnostic.severity === "error") errors += 1;
      else warnings += 1;
    }
    errorCount += errors;
    warningCount += warnings;
    results.push({
      file: absolute,
      relativePath: toPosix(path.relative(root, absolute)),
      diagnostics,
      errorCount: errors,
      warningCount: warnings,
    });
  }

  return { root, files: results, errorCount, warningCount };
}

async function filesFromPaths(paths: string[], cwd: string, ignore: string[]): Promise<string[]> {
  const files: string[] = [];
  const seen = new Set<string>();
  const add = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    files.push(file);
  };

  for (const p of paths) {
    const resolved = path.resolve(cwd, p);
    let info;
    try {
      info = await stat(resolved);
    } catch (err) {
      const code = errorCode(err);
      if (code === "ENOENT" || code === "ENOTDIR") throw new Error(`Path not found: ${p}`, { cause: err });
      throw err;
    }
    if (info.isDirectory()) {
      for (const file of await findAgentFiles(resolved, ignore)) add(file);
    } else if (info.isFile()) {
      add(resolved);
    } else {
      throw new Error(`Path not found: ${p}`);
    }
  }

  return files;
}

/** Lint AGENTS.md files under `cwd`. Missing paths throw. Unknown rule ids throw ConfigError. */
export async function lint(options: LintOptions): Promise<LintResult & { configPath?: string }> {
  const { cwd, paths = ["."], configPath } = options;
  const root = cwd;
  const explicit = configPath === undefined ? undefined : path.resolve(root, configPath);
  const loaded = await loadConfig(root, explicit);
  assertKnownRules(loaded.config);
  const files = await filesFromPaths(paths, root, loaded.config.ignore);
  const result = await lintFiles(files, root, loaded.config);
  return loaded.path === undefined ? result : { ...result, configPath: loaded.path };
}
