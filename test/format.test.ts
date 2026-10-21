import path from "node:path";
import { describe, expect, it } from "vitest";
import { toPosix } from "../src/discover.js";
import { formatGithub, formatJson, formatText } from "../src/format.js";
import type { Diagnostic, FileResult, LintResult } from "../src/types.js";

/** Absolute repo root. `/repo` is drive-absolute on Windows; pin a drive so relatives stay stable. */
const ROOT = process.platform === "win32" ? "C:\\repo" : "/repo";

function abs(...parts: string[]): string {
  return path.join(ROOT, ...parts);
}

function diagnostic(over: Partial<Diagnostic> & Pick<Diagnostic, "ruleId" | "severity" | "message">): Diagnostic {
  return { line: 1, column: 1, ...over };
}

function file(over: Partial<FileResult> & Pick<FileResult, "relativePath" | "diagnostics">): FileResult {
  const errorCount = over.errorCount ?? over.diagnostics.filter((item) => item.severity === "error").length;
  const warningCount = over.warningCount ?? over.diagnostics.filter((item) => item.severity === "warn").length;
  return {
    file: over.file ?? path.join(ROOT, ...over.relativePath.split(/[\\/]/)),
    relativePath: over.relativePath,
    diagnostics: over.diagnostics,
    errorCount,
    warningCount,
  };
}

function result(files: FileResult[]): LintResult {
  return {
    root: ROOT,
    files,
    errorCount: files.reduce((count, item) => count + item.errorCount, 0),
    warningCount: files.reduce((count, item) => count + item.warningCount, 0),
  };
}

describe("formatText", () => {
  it("prints a stylish report without ANSI when color is false", () => {
    const output = formatText(
      result([
        file({
          relativePath: "AGENTS.md",
          diagnostics: [diagnostic({ ruleId: "no-empty-file", severity: "error", message: "File is empty." })],
        }),
      ]),
      { color: false },
    );
    expect(output).toBe("AGENTS.md\n  1:1  error  File is empty.  no-empty-file\n\n✖ 1 problem (1 error, 0 warnings)\n");
    expect(output.includes("\u001b")).toBe(false);
  });

  it("uses ANSI when color is true", () => {
    const output = formatText(
      result([
        file({
          relativePath: "AGENTS.md",
          diagnostics: [diagnostic({ ruleId: "no-placeholder", severity: "warn", message: "Placeholder." })],
        }),
      ]),
      { color: true },
    );
    expect(output).toContain("\u001b[");
    expect(output).toContain("AGENTS.md");
    expect(output).toContain("no-placeholder");
    expect(output).toContain("warning");
  });

  it("pluralizes problems, errors, and warnings", () => {
    const error = diagnostic({ ruleId: "no-empty-file", severity: "error", message: "Empty." });
    const warning = diagnostic({ ruleId: "no-placeholder", severity: "warn", message: "Todo.", line: 2 });
    expect(formatText(result([file({ relativePath: "a.md", diagnostics: [error] })]))).toContain("✖ 1 problem (1 error, 0 warnings)");
    expect(formatText(result([file({ relativePath: "a.md", diagnostics: [error, { ...error, line: 2 }] })]))).toContain(
      "✖ 2 problems (2 errors, 0 warnings)",
    );
    expect(formatText(result([file({ relativePath: "a.md", diagnostics: [warning] })]))).toContain("✖ 1 problem (0 errors, 1 warning)");
    expect(formatText(result([file({ relativePath: "a.md", diagnostics: [error, warning] })]))).toContain(
      "✖ 2 problems (1 error, 1 warning)",
    );
  });

  it("hides warnings and drops them from the summary when quiet", () => {
    const output = formatText(
      result([
        file({
          relativePath: "AGENTS.md",
          diagnostics: [
            diagnostic({ ruleId: "no-broken-links", severity: "error", message: "Broken link." }),
            diagnostic({ ruleId: "no-placeholder", severity: "warn", message: "Placeholder text.", line: 4 }),
          ],
        }),
      ]),
      { quiet: true },
    );
    expect(output).toContain("Broken link.");
    expect(output).not.toContain("Placeholder text.");
    expect(output).toContain("✖ 1 problem (1 error, 0 warnings)");
  });

  it("reports a clean tree when quiet removes the only warnings", () => {
    const output = formatText(
      result([
        file({
          relativePath: "AGENTS.md",
          diagnostics: [diagnostic({ ruleId: "no-placeholder", severity: "warn", message: "Placeholder text." })],
        }),
      ]),
      { quiet: true },
    );
    expect(output).toBe("✔ 1 AGENTS.md file checked, no problems found.\n");
  });

  it("says when no files were found", () => {
    expect(formatText(result([]))).toBe("No AGENTS.md files found.\n");
  });

  it("pluralizes the clean-file summary", () => {
    const one = result([file({ relativePath: "AGENTS.md", diagnostics: [] })]);
    const two = result([
      file({ relativePath: "AGENTS.md", diagnostics: [] }),
      file({ relativePath: "pkg/AGENTS.md", diagnostics: [] }),
    ]);
    expect(formatText(one)).toBe("✔ 1 AGENTS.md file checked, no problems found.\n");
    expect(formatText(two)).toBe("✔ 2 AGENTS.md files checked, no problems found.\n");
  });

  it("prints every file that has diagnostics", () => {
    const output = formatText(
      result([
        file({
          relativePath: "AGENTS.md",
          diagnostics: [diagnostic({ ruleId: "no-empty-file", severity: "error", message: "Empty root." })],
        }),
        file({
          relativePath: "pkg/AGENTS.md",
          diagnostics: [diagnostic({ ruleId: "no-placeholder", severity: "warn", message: "Empty nested.", line: 3, column: 2 })],
        }),
      ]),
    );
    expect(output).toContain("AGENTS.md");
    expect(output).toContain("pkg/AGENTS.md");
    expect(output).toContain("Empty root.");
    expect(output).toContain("Empty nested.");
    expect(output.indexOf("AGENTS.md")).toBeLessThan(output.indexOf("pkg/AGENTS.md"));
  });
});

describe("formatJson", () => {
  it("emits the stable document shape", () => {
    const output = formatJson(
      result([
        file({
          file: abs("pkg", "AGENTS.md"),
          relativePath: "pkg/AGENTS.md",
          diagnostics: [diagnostic({ ruleId: "no-secrets", severity: "error", message: "Possible key.", line: 2, column: 4 })],
        }),
      ]),
    );
    expect(JSON.parse(output)).toEqual({
      version: 1,
      root: toPosix(ROOT),
      errorCount: 1,
      warningCount: 0,
      files: [
        {
          path: "pkg/AGENTS.md",
          errorCount: 1,
          warningCount: 0,
          diagnostics: [{ ruleId: "no-secrets", severity: "error", message: "Possible key.", line: 2, column: 4 }],
        },
      ],
    });
    expect(output).toContain('\n  "version": 1');
    expect(output.endsWith("\n")).toBe(false);
  });

  it("prints Windows-style paths with forward slashes", () => {
    const output = formatJson({
      ...result([]),
      root: "C:\\repo\\app",
      files: [file({ relativePath: "pkg\\AGENTS.md", diagnostics: [] })],
    });
    expect(JSON.parse(output)).toMatchObject({ root: "C:/repo/app", files: [{ path: "pkg/AGENTS.md" }] });
  });
});

describe("formatGithub", () => {
  it("emits one workflow command per diagnostic", () => {
    const output = formatGithub(
      result([
        file({
          file: abs("AGENTS.md"),
          relativePath: "AGENTS.md",
          diagnostics: [
            diagnostic({ ruleId: "no-empty-file", severity: "error", message: "Empty." }),
            diagnostic({ ruleId: "no-placeholder", severity: "warn", message: "Todo.", line: 3, column: 2 }),
          ],
        }),
      ]),
      ROOT,
    );
    expect(output).toBe(
      ["::error file=AGENTS.md,line=1,col=1,title=agentsmd-lint (no-empty-file)::Empty.", "::warning file=AGENTS.md,line=3,col=2,title=agentsmd-lint (no-placeholder)::Todo."].join(
        "\n",
      ),
    );
  });

  it("escapes percent, CR, and LF in messages, and comma and colon in properties", () => {
    const output = formatGithub(
      result([
        file({
          file: abs("name:with,comma.md"),
          relativePath: "name:with,comma.md",
          diagnostics: [diagnostic({ ruleId: "no-secrets", severity: "error", message: "100% done\r\nnext, still %0A", line: 2, column: 3 })],
        }),
      ]),
      ROOT,
    );
    expect(output).toBe(
      "::error file=name%3Awith%2Ccomma.md,line=2,col=3,title=agentsmd-lint (no-secrets)::100%25 done%0D%0Anext, still %250A",
    );
  });

  it("returns an empty string when there are no diagnostics", () => {
    expect(formatGithub(result([file({ relativePath: "AGENTS.md", diagnostics: [] })]), ROOT)).toBe("");
    expect(formatGithub(result([]), ROOT)).toBe("");
  });

  it("uses a path relative to the given cwd", () => {
    const output = formatGithub(
      result([
        file({
          file: abs("pkg", "AGENTS.md"),
          relativePath: "ignored.md",
          diagnostics: [diagnostic({ ruleId: "no-empty-file", severity: "error", message: "Empty." })],
        }),
      ]),
      ROOT,
    );
    expect(output.startsWith("::error file=pkg/AGENTS.md,")).toBe(true);
  });
});
