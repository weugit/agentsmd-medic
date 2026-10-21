import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { CONFIG_FILE_NAMES, ConfigError } from "./config.js";
import { DoctorUsageError, diagnose, formatDoctorJson, formatDoctorText } from "./doctor.js";
import { formatGithub, formatJson, formatText } from "./format.js";
import { lint } from "./linter.js";
import { rules } from "./rules/index.js";
import type { LintResult } from "./types.js";

interface Io {
  stdout: { write(s: string): unknown; isTTY?: boolean };
  stderr: { write(s: string): unknown };
  cwd: string;
  env?: Record<string, string | undefined>;
}

const FORMATS = ["text", "json", "github"] as const;
type FormatName = (typeof FORMATS)[number];

function isFormat(value: string): value is FormatName {
  return (FORMATS as readonly string[]).includes(value);
}

function helpText(): string {
  const configNames = CONFIG_FILE_NAMES.map((name) => `  ${name}`).join("\n");
  return `agentsmd-lint — lint AGENTS.md instruction files

Usage:
  agentsmd-lint [options] [path...]
  agentsmd-lint doctor [options] [dir]

Lint AGENTS.md and AGENTS.override.md files. A path that is a file is linted
directly. A path that is a directory is searched recursively. The default path
is ".".

doctor reports which instruction files each agent loads for [dir] (default:
the working directory), from that directory up to the git root. The git root
is the nearest ancestor that contains .git, or [dir] when there is none.
Agents: OpenAI Codex, Claude Code, Cursor, GitHub Copilot, and Gemini CLI.
Text output is grouped per agent and uses ✔ and ⚠ markers. --json (or
--format json) prints a versioned document. --format github is rejected.
doctor exits 0 unless the invocation is invalid. The first positional
argument "doctor" is the subcommand. A path such as ./doctor is still linted.

Options:
  -c, --config <file>     Config file. When omitted, the working directory is
                          searched for the config file names below
      --format <format>   Output format: text (default), json, or github
      --json              Alias for --format json. When both are set, the last
                          one wins
      --max-warnings <n>  Exit 1 when the warning count is greater than <n>.
                          <n> is an integer ≥ 0. Without this flag, warnings do
                          not change the exit code
      --color             Force colored text output
      --no-color          Disable colored text output
  -q, --quiet             Hide warnings in text output. Hidden warnings are
                          left out of the summary
      --list-rules        Print each rule id, its default severity, and its
                          description, then exit
  -h, --help              Show this help and exit
  -v, --version           Show the version number and exit

Color defaults to on when stdout is a TTY and the NO_COLOR environment
variable is unset. --color and --no-color override that (the last one wins).
Color is used for text output only.

Config files (first match in the working directory wins):
${configNames}

  "rules"          Map of rule id to "error", "warn", or "off"
  "ignore"         Directory names or path prefixes to skip while searching
  "maxBytes"       Soft size limit in bytes (default 32768)
  "maxTokens"      Soft token budget (default 8000). CJK and fullwidth
                   characters count as one token; other text is chars / 4

Inline comments in an AGENTS.md file:
  <!-- agentsmd-lint-disable -->
  <!-- agentsmd-lint-disable rule-a, rule-b -->
      Disable every rule, or the named rules, for the whole file.
  <!-- agentsmd-lint-disable-next-line -->
  <!-- agentsmd-lint-disable-next-line rule-a, rule-b -->
      Disable every rule, or the named rules, for the next non-blank line.
  Comments inside fenced code blocks are not treated as directives.

Exit codes:
  0  No errors, and warnings do not exceed --max-warnings.
     doctor exits 0 when the directory can be read, including when the
     report contains warnings
  1  One or more errors, or more warnings than --max-warnings
  2  Usage error, invalid config, or a path that does not exist
     The message is written to stderr and prefixed with "agentsmd-lint: ".
`;
}

async function packageVersion(): Promise<string> {
  const urls = [new URL("../package.json", import.meta.url), new URL("../../package.json", import.meta.url)];
  const failures: string[] = [];
  for (const url of urls) {
    try {
      const text = await readFile(url, "utf8");
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string") {
        return parsed.version;
      }
      failures.push(`${url.pathname}: missing string "version"`);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(`Could not read package version (${failures.join("; ")})`);
}

function listRulesText(): string {
  const idWidth = rules.reduce((width, rule) => Math.max(width, rule.id.length), 0);
  const severityWidth = rules.reduce((width, rule) => Math.max(width, rule.defaultSeverity.length), 0);
  return rules
    .map((rule) => `${rule.id.padEnd(idWidth)}  ${rule.defaultSeverity.padEnd(severityWidth)}  ${rule.description}`)
    .join("\n");
}

function writeLine(write: (s: string) => unknown, text: string): void {
  write(text.endsWith("\n") ? text : `${text}\n`);
}

function fail(io: Io, message: string): number {
  writeLine((s) => io.stderr.write(s), `agentsmd-lint: ${message}`);
  return 2;
}

function isUsageError(err: unknown): err is Error {
  return err instanceof ConfigError || err instanceof DoctorUsageError || (err instanceof Error && err.message.startsWith("Path not found:"));
}

/** Color is on for a TTY when NO_COLOR is unset, unless a flag overrides it. */
function useColor(io: Io, colorFlag: boolean | undefined): boolean {
  const env = io.env ?? {};
  if (colorFlag !== undefined) return colorFlag;
  return Boolean(io.stdout.isTTY) && !env.NO_COLOR;
}

/**
 * Run the CLI. Returns a process exit code: 0 ok, 1 findings, 2 usage or config error.
 */
export async function main(
  argv: string[],
  io: Io = {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    env: process.env,
  },
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      tokens: true,
      options: {
        json: { type: "boolean", default: false },
        format: { type: "string" },
        config: { type: "string", short: "c" },
        "max-warnings": { type: "string" },
        // Node 20 parseArgs has no allowNegative, so --no-color is its own flag.
        color: { type: "boolean", default: false },
        "no-color": { type: "boolean", default: false },
        quiet: { type: "boolean", short: "q", default: false },
        "list-rules": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (err) {
    return fail(io, err instanceof Error ? err.message : String(err));
  }

  if (parsed.values.help) {
    writeLine((s) => io.stdout.write(s), helpText());
    return 0;
  }
  if (parsed.values.version) {
    try {
      writeLine((s) => io.stdout.write(s), await packageVersion());
    } catch (err) {
      return fail(io, err instanceof Error ? err.message : String(err));
    }
    return 0;
  }
  if (parsed.values["list-rules"]) {
    writeLine((s) => io.stdout.write(s), listRulesText());
    return 0;
  }

  let formatName: string | undefined;
  let colorFlag: boolean | undefined;
  for (const token of parsed.tokens) {
    if (token.kind !== "option") continue;
    if (token.name === "format") formatName = token.value;
    else if (token.name === "json") formatName = "json";
    else if (token.name === "color") colorFlag = true;
    else if (token.name === "no-color") colorFlag = false;
  }
  const format = formatName ?? "text";
  if (!isFormat(format)) {
    return fail(io, `Invalid value for --format: "${format}". Expected text, json, or github.`);
  }

  const doctor = parsed.positionals[0] === "doctor";
  if (doctor) {
    if (parsed.positionals.length > 2) return fail(io, "doctor accepts at most one directory.");
    if (format === "github") return fail(io, "doctor does not support --format github. Use text or json.");
    const dirArg = parsed.positionals[1] ?? ".";
    try {
      const report = await diagnose(path.resolve(io.cwd, dirArg), dirArg);
      const output = format === "json" ? formatDoctorJson(report) : formatDoctorText(report, { color: useColor(io, colorFlag) });
      writeLine((s) => io.stdout.write(s), output);
      return 0;
    } catch (err) {
      if (isUsageError(err)) return fail(io, err.message);
      throw err;
    }
  }

  let maxWarnings = Number.POSITIVE_INFINITY;
  const rawMax = parsed.values["max-warnings"];
  if (rawMax !== undefined) {
    if (!/^\d+$/.test(rawMax)) {
      return fail(io, `--max-warnings must be an integer ≥ 0 (received ${rawMax}).`);
    }
    maxWarnings = Number(rawMax);
  }

  const color = useColor(io, colorFlag);

  let result: LintResult & { configPath?: string };
  try {
    result = await lint({
      cwd: io.cwd,
      paths: parsed.positionals.length > 0 ? parsed.positionals : ["."],
      configPath: parsed.values.config === undefined ? undefined : path.resolve(io.cwd, parsed.values.config),
    });
  } catch (err) {
    if (isUsageError(err)) return fail(io, err.message);
    throw err;
  }

  const output =
    format === "json"
      ? formatJson(result)
      : format === "github"
        ? formatGithub(result, io.cwd)
        : formatText(result, { color, quiet: parsed.values.quiet });
  if (output.length > 0) writeLine((s) => io.stdout.write(s), output);
  return result.errorCount > 0 || result.warningCount > maxWarnings ? 1 : 0;
}
