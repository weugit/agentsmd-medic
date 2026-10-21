import path from "node:path";
import { toPosix } from "./discover.js";
import type { Diagnostic, LintResult, Severity } from "./types.js";

const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const UNDERLINE = "\u001b[4m";
const RED = "\u001b[31m";
const YELLOW = "\u001b[33m";

export interface FormatTextOptions {
  /** ANSI color. Default false. */
  color?: boolean;
  /** Drop warnings from the report and from the summary. Default false. */
  quiet?: boolean;
}

function paint(text: string, code: string, color: boolean): string {
  return color ? `${code}${text}${RESET}` : text;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function severityWord(severity: Severity): "error" | "warning" {
  return severity === "error" ? "error" : "warning";
}

function formatRows(diagnostics: Diagnostic[], color: boolean): string {
  const words = diagnostics.map((d) => severityWord(d.severity));
  const lineWidth = diagnostics.reduce((width, d) => Math.max(width, String(d.line).length), 0);
  const columnWidth = diagnostics.reduce((width, d) => Math.max(width, String(d.column).length), 0);
  const severityWidth = words.reduce((width, word) => Math.max(width, word.length), 0);
  const messageWidth = diagnostics.reduce((width, d) => Math.max(width, d.message.length), 0);

  return diagnostics
    .map((d, index) => {
      const word = words[index] ?? "error";
      const line = String(d.line);
      const column = String(d.column);
      const position = `${" ".repeat(lineWidth - line.length)}${paint(`${line}:${column}`, DIM, color)}${" ".repeat(columnWidth - column.length)}`;
      const severity = `${paint(word, word === "error" ? RED : YELLOW, color)}${" ".repeat(severityWidth - word.length)}`;
      const message = d.message.padEnd(messageWidth);
      return `  ${position}  ${severity}  ${message}  ${d.ruleId}`;
    })
    .join("\n");
}

/**
 * ESLint-stylish text report. Paths are relative (as stored on the result).
 * With `color`, the path is bold and underlined, positions are dim, errors are
 * red, and warnings are yellow.
 */
export function formatText(result: LintResult, options: FormatTextOptions = {}): string {
  const color = options.color ?? false;
  const quiet = options.quiet ?? false;
  if (result.files.length === 0) return "No AGENTS.md files found.\n";

  const blocks: string[] = [];
  let errors = 0;
  let warnings = 0;
  for (const file of result.files) {
    const diagnostics = quiet ? file.diagnostics.filter((d) => d.severity === "error") : file.diagnostics;
    for (const diagnostic of diagnostics) {
      if (diagnostic.severity === "error") errors += 1;
      else warnings += 1;
    }
    if (diagnostics.length === 0) continue;
    const heading = paint(file.relativePath, `${BOLD}${UNDERLINE}`, color);
    blocks.push(`${heading}\n${formatRows(diagnostics, color)}\n`);
  }

  const total = errors + warnings;
  if (total === 0) {
    const noun = result.files.length === 1 ? "file" : "files";
    return `✔ ${result.files.length} AGENTS.md ${noun} checked, no problems found.\n`;
  }
  const summary = `✖ ${plural(total, "problem")} (${plural(errors, "error")}, ${plural(warnings, "warning")})`;
  return `${blocks.join("\n")}\n${summary}\n`;
}

/** Stable report document for editors and scripts. */
export function formatJson(result: LintResult): string {
  return JSON.stringify(
    {
      version: 1,
      root: result.root,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
      files: result.files.map((file) => ({
        path: file.relativePath,
        errorCount: file.errorCount,
        warningCount: file.warningCount,
        diagnostics: file.diagnostics.map((d) => ({
          ruleId: d.ruleId,
          severity: d.severity,
          message: d.message,
          line: d.line,
          column: d.column,
        })),
      })),
    },
    null,
    2,
  );
}

/** `%`, CR, and LF in workflow-command data. `%` is replaced first. */
function escapeData(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/** Property values also escape `,` and `:`. */
function escapeProperty(value: string): string {
  return escapeData(value).replaceAll(",", "%2C").replaceAll(":", "%3A");
}

/** One GitHub Actions workflow command per diagnostic. Paths are relative to `cwd`. */
export function formatGithub(result: LintResult, cwd: string): string {
  const lines: string[] = [];
  for (const file of result.files) {
    const rel = escapeProperty(toPosix(path.relative(cwd, path.resolve(file.file))));
    for (const diagnostic of file.diagnostics) {
      const kind = diagnostic.severity === "error" ? "error" : "warning";
      const title = escapeProperty(`agentsmd-lint (${diagnostic.ruleId})`);
      const message = escapeData(diagnostic.message);
      lines.push(`::${kind} file=${rel},line=${diagnostic.line},col=${diagnostic.column},title=${title}::${message}`);
    }
  }
  return lines.join("\n");
}
