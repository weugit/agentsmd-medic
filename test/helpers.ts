import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { lintText } from "../src/linter.js";
import type { Config, Diagnostic } from "../src/types.js";

const temps: string[] = [];

afterEach(async () => {
  const pending = temps.splice(0, temps.length);
  await Promise.all(pending.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Fresh directory under the OS temp dir. Removed after each test. */
export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "agentsmd-doctor-"));
  temps.push(dir);
  return dir;
}

/** Write `files` (posix relative paths) under `root`, creating parents. */
export async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split("/"));
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
}

export function withConfig(override: Partial<Config> = {}): Config {
  return {
    ...DEFAULT_CONFIG,
    ...override,
    rules: { ...DEFAULT_CONFIG.rules, ...override.rules },
    ignore: override.ignore ?? [...DEFAULT_CONFIG.ignore],
  };
}

/** Drive-qualified on Windows so virtual paths stay absolute and on one drive. */
const VIRTUAL_ROOT = process.platform === "win32" ? "C:\\virtual" : "/virtual";

/** Lint a source string. `file` and `root` default to a virtual path. */
export function lintSource(
  source: string,
  config?: Partial<Config>,
  file = path.join(VIRTUAL_ROOT, "AGENTS.md"),
  root = VIRTUAL_ROOT,
): Diagnostic[] {
  return lintText(source, { file, root, config: withConfig(config) });
}

/** Lint `source` as `rel` inside a real `root` (callers create any files the rules read). */
export function lintAt(root: string, rel: string, source: string, config?: Partial<Config>): Diagnostic[] {
  const file = path.join(root, ...rel.split("/"));
  return lintText(source, { file, root, config: withConfig(config) });
}

export function forRule(diagnostics: Diagnostic[], ruleId: string): Diagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.ruleId === ruleId);
}
