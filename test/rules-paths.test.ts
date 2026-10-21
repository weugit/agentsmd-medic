import { describe, expect, it } from "vitest";
import { forRule, lintAt, tempDir, writeTree } from "./helpers.js";

async function repo(): Promise<string> {
  const root = await tempDir();
  await writeTree(root, {
    "package.json": "{}\n",
    "src/index.ts": "export {}\n",
    "pkg/AGENTS.md": "# Nested\n",
    "docs/readme.md": "docs\n",
  });
  return root;
}

function paths(root: string, rel: string, source: string) {
  return forRule(lintAt(root, rel, source), "no-missing-paths");
}

describe("no-missing-paths", () => {
  it("flags a missing file referenced from inline code", async () => {
    const root = await repo();
    const findings = paths(root, "AGENTS.md", "# Setup\n\nEdit `src/missing.ts`.\n");
    expect(findings).toEqual([
      {
        ruleId: "no-missing-paths",
        severity: "warn",
        message: "Referenced path `src/missing.ts` does not exist",
        line: 3,
        column: 7,
      },
    ]);
  });

  it("accepts a path that exists relative to the file or the repo root", async () => {
    const root = await repo();
    const source = "# Setup\n\nSee `src/index.ts` and `package.json`.\n";
    expect(paths(root, "pkg/AGENTS.md", source)).toEqual([]);
    expect(paths(root, "AGENTS.md", source)).toEqual([]);
  });

  it("flags a slash path whose first segment exists when the rest does not", async () => {
    const root = await repo();
    const findings = paths(root, "AGENTS.md", "# Setup\n\nOpen `src/components`.\n");
    expect(findings.map((finding) => finding.message)).toEqual(["Referenced path `src/components` does not exist"]);
  });

  it("does not flag a slash path whose first segment is absent and has no extension", async () => {
    const root = await repo();
    expect(paths(root, "AGENTS.md", "# Setup\n\nSee `vendor/left-pad`.\n")).toEqual([]);
  });

  it("flags a trailing-slash directory that does not exist", async () => {
    const root = await repo();
    const findings = paths(root, "AGENTS.md", "# Setup\n\nLook in `generated/`.\n");
    expect(findings).toHaveLength(1);
  });

  it("accepts an existing directory with a trailing slash", async () => {
    const root = await repo();
    expect(paths(root, "AGENTS.md", "# Setup\n\nLook in `src/` and `docs/`.\n")).toEqual([]);
  });

  it.each([
    "https://example.com/README.md",
    "http://example.com/a.ts",
    "//cdn.example.com/app.js",
    "www.example.com/a.js",
    "src/**/*.ts",
    "file?.md",
    "{a,b}.ts",
    "[id].tsx",
    "-rf",
    "~/.ssh/id_rsa",
    "/etc/hosts",
    "$HOME/bin/tool",
    "foo bar.md",
    "user@host",
    "@scope/pkg",
  ])("ignores %s", async (value) => {
    const root = await repo();
    expect(paths(root, "AGENTS.md", `# Setup\n\nSee \`${value}\`.\n`)).toEqual([]);
  });

  it("does not treat fenced code as a path reference", async () => {
    const root = await repo();
    const source = "# Setup\n\n```\nsrc/missing.ts\n```\n";
    expect(paths(root, "AGENTS.md", source)).toEqual([]);
  });

  it("flags a bare filename with a known extension", async () => {
    const root = await repo();
    const findings = paths(root, "AGENTS.md", "# Setup\n\nRead `NOTES.md`.\n");
    expect(findings[0]?.message).toBe("Referenced path `NOTES.md` does not exist");
  });

  it("ignores a bare word with no extension", async () => {
    const root = await repo();
    expect(paths(root, "AGENTS.md", "# Setup\n\nRun `build` then `test`.\n")).toEqual([]);
  });
});
