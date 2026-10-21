import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/config.js";
import { lint } from "../src/linter.js";
import { forRule, lintAt, lintSource, tempDir, writeTree } from "./helpers.js";

const clean = `# Setup

Install dependencies and run the tests.
`;

describe("lintText", () => {
  it("applies a severity override", () => {
    const findings = forRule(lintSource("# Work\n\nTODO\n", { rules: { "no-placeholder": "error" } }), "no-placeholder");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("error");
  });

  it("turns a default error into a warning", () => {
    const findings = lintSource("", { rules: { "no-empty-file": "warn" } });
    expect(findings).toEqual([
      {
        ruleId: "no-empty-file",
        severity: "warn",
        message: "File is empty; agents will get no instructions from it.",
        line: 1,
        column: 1,
      },
    ]);
  });

  it('honors "off"', () => {
    expect(lintSource("", { rules: { "no-empty-file": "off" } })).toEqual([]);
    expect(forRule(lintSource("Just text.\n", { rules: { "require-heading": "off" } }), "require-heading")).toEqual([]);
  });

  it("throws ConfigError for an unknown rule id", () => {
    expect(() => lintSource(clean, { rules: { "no-such-rule": "error" } })).toThrow(ConfigError);
    expect(() => lintSource(clean, { rules: { "no-such-rule": "error" } })).toThrow(/Unknown rule "no-such-rule"/);
    expect(() => lintSource(clean, { rules: { "no-such-rule": "warn" } })).toThrow(/Valid rule ids:/);
  });

  it("disables every rule for the whole file", () => {
    expect(lintSource("<!-- agentsmd-doctor-disable -->\n")).toEqual([]);
    const later = "TODO\n\n<!-- agentsmd-doctor-disable -->\n";
    expect(lintSource(later)).toEqual([]);
  });

  it("disables only the named rules", () => {
    const source = "<!-- agentsmd-doctor-disable no-placeholder, no-secrets -->\n# Work\n\nTODO\n";
    const findings = lintSource(source);
    expect(forRule(findings, "no-placeholder")).toEqual([]);
    expect(findings.some((finding) => finding.ruleId === "no-empty-file")).toBe(false);
    expect(forRule(lintSource("# Work\n\nTODO\n"), "no-placeholder")).toHaveLength(1);
  });

  it("disables the next non-blank line", () => {
    const source = ["# Work", "", "<!-- agentsmd-doctor-disable-next-line no-placeholder -->", "TODO", "FIXME", ""].join("\n");
    const findings = forRule(lintSource(source), "no-placeholder");
    expect(findings.map((finding) => finding.message)).toEqual(['Placeholder text "FIXME" found; agents may follow it literally.']);
  });

  it("skips blank lines when applying disable-next-line", () => {
    const source = ["# Work", "", "<!-- agentsmd-doctor-disable-next-line -->", "", "TODO", ""].join("\n");
    expect(forRule(lintSource(source), "no-placeholder")).toEqual([]);
  });

  it("does not treat a directive inside a fence as a disable", () => {
    const source = ["# Work", "", "```", "<!-- agentsmd-doctor-disable -->", "```", "", "TODO outside", ""].join("\n");
    expect(forRule(lintSource(source), "no-placeholder")).toHaveLength(1);
  });

  it("sorts by line, column, then rule id", () => {
    const dup = ["## Dup", "", "TODO one", "", "## Dup", "", "FIXME two"].join("\n");
    const ordered = lintSource(dup).filter((finding) => finding.ruleId === "no-placeholder" || finding.ruleId === "no-duplicate-heading");
    expect(ordered.map((finding) => [finding.line, finding.ruleId])).toEqual([
      [3, "no-placeholder"],
      [5, "no-duplicate-heading"],
      [7, "no-placeholder"],
    ]);
  });

  it("sorts same-line diagnostics by column and rule id", async () => {
    const root = await tempDir();
    const findings = lintAt(root, "AGENTS.md", "TODO [missing](missing.md)\n");
    expect(findings.map((finding) => [finding.column, finding.ruleId])).toEqual([
      [1, "no-placeholder"],
      [1, "require-heading"],
      [6, "no-broken-links"],
    ]);
  });
});

describe("lint", () => {
  it("lints one file path and reports counts", async () => {
    const root = await tempDir();
    await writeTree(root, {
      "AGENTS.md": "# Setup\n\nTODO\n",
      "notes.md": clean,
    });
    const result = await lint({ cwd: root, paths: ["notes.md"] });
    expect(result.files.map((file) => file.relativePath)).toEqual(["notes.md"]);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.files[0]?.diagnostics).toEqual([]);
  });

  it("lints a directory shallow-first and sums counts", async () => {
    const root = await tempDir();
    await writeTree(root, {
      "AGENTS.md": clean,
      "pkg/AGENTS.md": "",
      "pkg/deep/AGENTS.md": "# Deep\n\nTODO\n",
    });
    const result = await lint({ cwd: root, paths: ["."] });
    expect(result.root).toBe(root);
    expect(result.files.map((file) => file.relativePath)).toEqual(["AGENTS.md", "pkg/AGENTS.md", "pkg/deep/AGENTS.md"]);
    expect(result.files.map((file) => [file.errorCount, file.warningCount])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
    ]);
    expect(result.errorCount).toBe(1);
    expect(result.warningCount).toBe(1);
    expect(result.configPath).toBeUndefined();
  });

  it("throws when a path does not exist", async () => {
    const root = await tempDir();
    await expect(lint({ cwd: root, paths: ["missing.md"] })).rejects.toThrow("Path not found: missing.md");
    await expect(lint({ cwd: root, paths: ["missing-dir"] })).rejects.toThrow(/^Path not found: missing-dir$/);
  });

  it("loads config severity from the working directory", async () => {
    const root = await tempDir();
    await writeTree(root, {
      ".agentsmd-doctor.json": JSON.stringify({ rules: { "no-placeholder": "error" } }),
      "AGENTS.md": "# Work\n\nTODO\n",
    });
    const result = await lint({ cwd: root });
    expect(result.configPath).toBe(path.join(root, ".agentsmd-doctor.json"));
    expect(result.errorCount).toBe(1);
    expect(result.warningCount).toBe(0);
    expect(result.files[0]?.diagnostics[0]?.ruleId).toBe("no-placeholder");
  });

  it("throws ConfigError when config names an unknown rule", async () => {
    const root = await tempDir();
    await writeTree(root, {
      ".agentsmd-doctor.json": JSON.stringify({ rules: { nope: "warn" } }),
      "AGENTS.md": clean,
    });
    await expect(lint({ cwd: root })).rejects.toThrow(ConfigError);
    await expect(lint({ cwd: root })).rejects.toThrow(/Unknown rule "nope"/);
  });
});
