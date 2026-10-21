import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  CLAUDE_AGENTS_IGNORED,
  CLAUDE_LOCAL_WARNING,
  CODEX_PROJECT_DOC_MAX_BYTES,
  CURSOR_LEGACY_WARNING,
  GEMINI_ONLY_AGENTS_WARNING,
  agentInfo,
  type AgentInfo,
} from "./agents.js";
import { SKIP_DIRECTORY_NAMES, escapesRoot, toPosix } from "./discover.js";

const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";

const SPECIAL_DIRS = new Set([".cursor", ".github", ".gemini"]);

export class DoctorUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DoctorUsageError";
  }
}

export interface DoctorFile {
  /** Path relative to the repo root, using forward slashes. */
  path: string;
  bytes: number;
  role: string;
  /** False when the file is present but this agent does not load it. */
  loaded: boolean;
  note?: string;
}

export interface DoctorAgent {
  id: AgentInfo["id"];
  name: string;
  docsUrl: string;
  status: "ok" | "warn";
  files: DoctorFile[];
  notes: string[];
  warnings: string[];
}

export interface DoctorReport {
  version: 1;
  command: "doctor";
  /** Absolute path of the directory that was checked. */
  directory: string;
  /** Absolute git root, or `directory` when no ancestor contains `.git`. */
  root: string;
  agents: DoctorAgent[];
}

interface DiskFile {
  abs: string;
  rel: string;
  name: string;
  bytes: number;
  dir: string;
}

interface GeminiConfig {
  names: string[];
  configured: boolean;
  settingsPath?: string;
  invalid: boolean;
}

function paint(text: string, code: string, color: boolean): string {
  return color ? `${code}${text}${RESET}` : text;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function relPosix(root: string, abs: string): string {
  return toPosix(path.relative(root, abs));
}

/** Nearest ancestor of `dir` that contains `.git`, or `dir` itself. */
export function findGitRoot(dir: string): string {
  let current = path.resolve(dir);
  for (;;) {
    if (existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(dir);
    current = parent;
  }
}

/** Directories from the git root down to `dir`, inclusive. */
export function directoriesFromRoot(root: string, dir: string): string[] {
  const absRoot = path.resolve(root);
  const absDir = path.resolve(dir);
  const rel = path.relative(absRoot, absDir);
  if (escapesRoot(rel)) return [absDir];
  const dirs = [absRoot];
  let current = absRoot;
  for (const part of rel.split(path.sep)) {
    if (!part || part === ".") continue;
    current = path.join(current, part);
    dirs.push(current);
  }
  return dirs;
}

function compareRel(a: string, b: string): number {
  const depth = a.split("/").length - b.split("/").length;
  return depth || a.localeCompare(b);
}

function basenameOf(spec: string): string {
  return path.posix.basename(spec.replaceAll("\\", "/"));
}

/** Relative `@AGENTS.md` spec on a Claude import line, without the leading `@`. */
export function agentsMdImportSpec(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("@")) return undefined;
  const token = trimmed.slice(1).trim().split(/\s+/)[0] ?? "";
  const cleaned = token.replace(/[?#].*$/, "").replace(/[),.;:]+$/g, "").replace(/^<|>$/g, "");
  if (!cleaned || cleaned.startsWith("/") || cleaned.startsWith("\\")) return undefined;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(cleaned)) return undefined;
  if (basenameOf(cleaned) !== "AGENTS.md") return undefined;
  return cleaned;
}

/** True when `source` has an `@AGENTS.md` import outside fenced code. */
export function claudeFileImportsAgentsMd(source: string): boolean {
  return claudeImportSpecs(source).length > 0;
}

/** `@AGENTS.md` import specs outside fenced code, in source order. */
export function claudeImportSpecs(source: string): string[] {
  const specs: string[] = [];
  let fence: "`" | "~" | undefined;
  for (const line of source.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line);
    if (marker?.[1]) {
      const kind = marker[1].startsWith("`") ? "`" : "~";
      if (!fence) fence = kind;
      else if (fence === kind) fence = undefined;
      continue;
    }
    if (fence) continue;
    const spec = agentsMdImportSpec(line);
    if (spec) specs.push(spec);
  }
  return specs;
}

function pathHasSegments(rel: string, segments: readonly string[]): boolean {
  const parts = rel.split("/");
  for (let i = 0; i <= parts.length - segments.length; i++) {
    let matches = true;
    for (let j = 0; j < segments.length; j++) {
      if (parts[i + j] !== segments[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function isInteresting(rel: string, name: string, extraNames: ReadonlySet<string>): boolean {
  if (
    name === "AGENTS.md" ||
    name === "AGENTS.override.md" ||
    name === "CLAUDE.md" ||
    name === "CLAUDE.local.md" ||
    name === "GEMINI.md" ||
    name === ".cursorrules" ||
    extraNames.has(name)
  ) {
    return true;
  }
  if (name.endsWith(".mdc") && pathHasSegments(rel, [".cursor", "rules"])) return true;
  if (name === "copilot-instructions.md" && pathHasSegments(rel, [".github"]) && rel.endsWith(".github/copilot-instructions.md")) return true;
  if (name.endsWith(".instructions.md") && pathHasSegments(rel, [".github", "instructions"])) return true;
  if (name === "settings.json" && rel.endsWith(".gemini/settings.json")) return true;
  return false;
}

async function walk(dir: string, root: string, recursive: boolean, extraNames: ReadonlySet<string>, out: DiskFile[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORY_NAMES.has(entry.name)) continue;
      if (recursive || SPECIAL_DIRS.has(entry.name)) await walk(abs, root, true, extraNames, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = relPosix(root, abs);
    if (!isInteresting(rel, entry.name, extraNames)) continue;
    let bytes = 0;
    try {
      bytes = (await stat(abs)).size;
    } catch {
      continue;
    }
    out.push({ abs, rel, name: entry.name, bytes, dir });
  }
}

function contextFileNames(value: unknown): string[] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const context = (value as { context?: unknown }).context;
  if (typeof context !== "object" || context === null || Array.isArray(context)) return undefined;
  const fileName = (context as { fileName?: unknown }).fileName;
  if (typeof fileName === "string") {
    const name = fileName.trim();
    return name ? [name] : undefined;
  }
  if (!Array.isArray(fileName)) return undefined;
  const names = fileName.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  return names.length > 0 ? names : undefined;
}

async function loadGeminiConfig(chain: string[], root: string): Promise<GeminiConfig> {
  for (let i = chain.length - 1; i >= 0; i--) {
    const dir = chain[i];
    if (!dir) continue;
    const abs = path.join(dir, ".gemini", "settings.json");
    let text: string;
    try {
      text = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    const settingsPath = relPosix(root, abs);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { names: ["GEMINI.md"], configured: false, settingsPath, invalid: true };
    }
    const names = contextFileNames(parsed);
    if (!names) return { names: ["GEMINI.md"], configured: false, settingsPath, invalid: false };
    return { names, configured: true, settingsPath, invalid: false };
  }
  return { names: ["GEMINI.md"], configured: false, invalid: false };
}

function onChain(file: DiskFile, chain: ReadonlySet<string>): boolean {
  return chain.has(file.dir);
}

function listed(file: DiskFile, role: string, loaded: boolean, note?: string): DoctorFile {
  const entry: DoctorFile = { path: file.rel, bytes: file.bytes, role, loaded };
  if (note) entry.note = note;
  return entry;
}

function finish(info: AgentInfo, files: DoctorFile[], notes: string[], warnings: string[]): DoctorAgent {
  return {
    id: info.id,
    name: info.name,
    docsUrl: info.docsUrl,
    status: warnings.length > 0 ? "warn" : "ok",
    files: [...files].sort((a, b) => compareRel(a.path, b.path)),
    notes,
    warnings,
  };
}

function reportCodex(files: DiskFile[], chain: string[]): DoctorAgent {
  const info = agentInfo("codex");
  const chainSet = new Set(chain);
  const chosen: DiskFile[] = [];
  for (const dir of chain) {
    const inDir = files.filter((file) => file.dir === dir && chainSet.has(dir));
    const override = inDir.find((file) => file.name === "AGENTS.override.md");
    const agents = inDir.find((file) => file.name === "AGENTS.md");
    const pick = override ?? agents;
    if (pick) chosen.push(pick);
  }
  const bytes = chosen.reduce((sum, file) => sum + file.bytes, 0);
  const notes: string[] = [];
  const warnings: string[] = [];
  if (chosen.length === 0) {
    notes.push("No AGENTS.md or AGENTS.override.md on the path from the repo root to this directory.");
    notes.push("Default cap is 32 KiB (project_doc_max_bytes).");
  } else {
    notes.push(`Concatenates ${plural(chosen.length, "file")} from the repo root down to this directory (${bytes} bytes).`);
    if (bytes > CODEX_PROJECT_DOC_MAX_BYTES) {
      warnings.push(`Combined size is ${bytes} bytes, over the ${CODEX_PROJECT_DOC_MAX_BYTES}-byte default cap (project_doc_max_bytes).`);
    } else {
      notes.push("Combined size is within the default 32 KiB cap (project_doc_max_bytes).");
    }
  }
  return finish(
    info,
    chosen.map((file) => listed(file, "codex-project-doc", true)),
    notes,
    warnings,
  );
}

async function reportClaude(files: DiskFile[], chain: string[]): Promise<DoctorAgent> {
  const info = agentInfo("claude");
  const chainSet = new Set(chain);
  const claude = files.filter((file) => file.name === "CLAUDE.md" && onChain(file, chainSet));
  const local = files.filter((file) => file.name === "CLAUDE.local.md" && onChain(file, chainSet));
  const agents = files.filter((file) => file.name === "AGENTS.md" && onChain(file, chainSet));
  const importing = new Set<string>();
  const importedAgents = new Set<string>();
  for (const file of claude) {
    let text = "";
    try {
      text = await readFile(file.abs, "utf8");
    } catch {
      continue;
    }
    const specs = claudeImportSpecs(text);
    if (specs.length === 0) continue;
    importing.add(file.abs);
    for (const spec of specs) importedAgents.add(path.resolve(file.dir, spec));
  }
  const notes: string[] = [];
  const warnings: string[] = [];
  if (claude.length === 0) notes.push("No CLAUDE.md on the path from the repo root to this directory.");
  else notes.push(`Reads ${plural(claude.length, "CLAUDE.md file")} up the tree.`);
  if (importing.size > 0) notes.push("A CLAUDE.md imports AGENTS.md.");
  if (local.length > 0) warnings.push(CLAUDE_LOCAL_WARNING);
  if (agents.length > 0 && importing.size === 0) warnings.push(CLAUDE_AGENTS_IGNORED);

  const listedFiles: DoctorFile[] = [
    ...claude.map((file) => listed(file, "claude-md", true, importing.has(file.abs) ? "imports AGENTS.md" : undefined)),
    ...local.map((file) => listed(file, "claude-local", true, "personal, git-ignored")),
    ...agents.map((file) => {
      const loaded = importedAgents.has(file.abs);
      return listed(file, "agents-md", loaded, loaded ? undefined : "not imported");
    }),
  ];
  return finish(info, listedFiles, notes, warnings);
}

function reportCursor(files: DiskFile[]): DoctorAgent {
  const info = agentInfo("cursor");
  const agents = files.filter((file) => file.name === "AGENTS.md");
  const rules = files.filter((file) => file.name.endsWith(".mdc") && pathHasSegments(file.rel, [".cursor", "rules"]));
  const legacy = files.filter((file) => file.name === ".cursorrules");
  const notes: string[] = [];
  const warnings: string[] = [];
  const parts: string[] = [];
  if (agents.length > 0) parts.push(`AGENTS.md (${agents.length})`);
  if (rules.length > 0) parts.push(`.cursor/rules/*.mdc (${rules.length})`);
  if (legacy.length > 0) parts.push(`.cursorrules (${legacy.length})`);
  if (parts.length === 0) notes.push("No Cursor instruction files found (AGENTS.md, .cursor/rules/*.mdc, or .cursorrules).");
  else notes.push(`Found ${parts.join(", ")}.`);
  if (legacy.length > 0) warnings.push(CURSOR_LEGACY_WARNING);
  return finish(
    info,
    [
      ...agents.map((file) => listed(file, "agents-md", true)),
      ...rules.map((file) => listed(file, "cursor-rule", true)),
      ...legacy.map((file) => listed(file, "cursorrules", true, "deprecated")),
    ],
    notes,
    warnings,
  );
}

function reportCopilot(files: DiskFile[]): DoctorAgent {
  const info = agentInfo("copilot");
  const repoWide = files.filter((file) => file.rel.endsWith(".github/copilot-instructions.md"));
  const modular = files.filter((file) => file.name.endsWith(".instructions.md") && pathHasSegments(file.rel, [".github", "instructions"]));
  const agents = files.filter((file) => file.name === "AGENTS.md");
  const notes: string[] = [];
  const parts: string[] = [];
  if (repoWide.length > 0) parts.push(`.github/copilot-instructions.md (${repoWide.length})`);
  if (modular.length > 0) parts.push(`.github/instructions/*.instructions.md (${modular.length})`);
  if (agents.length > 0) parts.push(`AGENTS.md (${agents.length})`);
  if (parts.length === 0) {
    notes.push("No Copilot instruction files found (.github/copilot-instructions.md, .github/instructions/*.instructions.md, or AGENTS.md).");
  } else {
    notes.push(`Found ${parts.join(", ")}.`);
  }
  return finish(
    info,
    [
      ...repoWide.map((file) => listed(file, "copilot-instructions", true)),
      ...modular.map((file) => listed(file, "copilot-path-instructions", true)),
      ...agents.map((file) => listed(file, "agents-md", true)),
    ],
    notes,
    [],
  );
}

function geminiRole(name: string): string {
  if (name === "GEMINI.md") return "gemini-md";
  if (name === "AGENTS.md") return "agents-md";
  return "gemini-context";
}

function reportGemini(files: DiskFile[], config: GeminiConfig): DoctorAgent {
  const info = agentInfo("gemini");
  const names = new Set(config.names);
  const contextFiles = files.filter((file) => names.has(file.name) && file.name !== "settings.json");
  const agents = files.filter((file) => file.name === "AGENTS.md");
  const loadsAgents = names.has("AGENTS.md");
  const notes: string[] = [];
  const warnings: string[] = [];
  if (config.invalid && config.settingsPath) {
    warnings.push(`Could not parse ${config.settingsPath}; assuming the default context file GEMINI.md.`);
  }
  if (config.configured && config.settingsPath) {
    notes.push(`context.fileName in ${config.settingsPath} is ${config.names.join(", ")}.`);
  }
  const onlyAgents = agents.length > 0 && contextFiles.length === 0 && !loadsAgents;
  if (contextFiles.length > 0) notes.push(`Loads ${plural(contextFiles.length, "context file")}.`);
  else if (!onlyAgents) notes.push("No Gemini context files found.");
  if (agents.length > 0 && !loadsAgents && !onlyAgents) {
    notes.push("AGENTS.md is not loaded unless context.fileName includes it.");
  }
  if (onlyAgents) warnings.push(GEMINI_ONLY_AGENTS_WARNING);

  const seen = new Set<string>();
  const listedFiles: DoctorFile[] = [];
  for (const file of contextFiles) {
    seen.add(file.abs);
    listedFiles.push(listed(file, geminiRole(file.name), true));
  }
  for (const file of agents) {
    if (seen.has(file.abs)) continue;
    listedFiles.push(listed(file, "agents-md", loadsAgents, loadsAgents ? undefined : "not a Gemini context file"));
  }
  return finish(info, listedFiles, notes, warnings);
}

/**
 * Report which instruction files each agent loads for `dir`.
 * `dir` is the directory under check. The walk stops at the git root.
 * `displayPath` is the path named in usage errors. It defaults to `dir`.
 */
export async function diagnose(dir: string, displayPath = dir): Promise<DoctorReport> {
  const directory = path.resolve(dir);
  let info;
  try {
    info = await stat(directory);
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? err.code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") throw new DoctorUsageError(`Path not found: ${displayPath}`);
    throw err;
  }
  if (!info.isDirectory()) throw new DoctorUsageError(`doctor expects a directory (received ${displayPath}).`);

  const root = findGitRoot(directory);
  const chain = directoriesFromRoot(root, directory);
  const gemini = await loadGeminiConfig(chain, root);
  const extraNames = new Set(gemini.names);
  const found: DiskFile[] = [];
  const leaf = chain[chain.length - 1] ?? directory;
  for (const current of chain) {
    await walk(current, root, current === leaf, extraNames, found);
  }
  const unique = new Map<string, DiskFile>();
  for (const file of found) unique.set(file.abs, file);
  const files = [...unique.values()];

  const agents = [
    reportCodex(files, chain),
    await reportClaude(files, chain),
    reportCursor(files),
    reportCopilot(files),
    reportGemini(files, gemini),
  ];
  return { version: 1, command: "doctor", directory, root, agents };
}

function displayReport(report: DoctorReport): DoctorReport {
  return {
    ...report,
    directory: toPosix(report.directory),
    root: toPosix(report.root),
    agents: report.agents.map((agent) => ({
      ...agent,
      files: agent.files.map((file) => ({ ...file, path: toPosix(file.path) })),
    })),
  };
}

function fileLine(file: DoctorFile): string {
  const note = file.note ? `, ${file.note}` : "";
  return `    ${file.path} (${file.bytes} bytes${note})`;
}

/** Human report grouped by agent. ✔ and ⚠ are colored when `color` is set. */
export function formatDoctorText(report: DoctorReport, options: { color?: boolean } = {}): string {
  const color = options.color ?? false;
  const shown = displayReport(report);
  const lines: string[] = [
    `Directory: ${shown.directory}`,
    `Repo root: ${shown.root}`,
    "Home-directory instruction files are not scanned.",
    "",
  ];
  for (const agent of shown.agents) {
    lines.push(paint(agent.name, BOLD, color));
    for (const note of agent.notes) lines.push(`  ${paint("✔", GREEN, color)} ${note}`);
    for (const warning of agent.warnings) lines.push(`  ${paint("⚠", YELLOW, color)} ${warning}`);
    for (const file of agent.files) lines.push(fileLine(file));
    lines.push("");
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}

/** Stable JSON document (`version` 1). */
export function formatDoctorJson(report: DoctorReport): string {
  return JSON.stringify(displayReport(report), null, 2);
}
