import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { toPosix } from "../src/discover.js";
import { rules } from "../src/rules/index.js";
import { tempDir, writeTree } from "./helpers.js";

const clean = `# Setup

Install dependencies and run the tests.
`;

const pkg = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")) as { version: string };

function capture(cwd: string, options?: { tty?: boolean; env?: Record<string, string | undefined> }) {
  let stdout = "";
  let stderr = "";
  const io = {
    stdout: {
      write(chunk: string) {
        stdout += chunk;
        return true;
      },
      isTTY: options?.tty ?? false,
    },
    stderr: {
      write(chunk: string) {
        stderr += chunk;
        return true;
      },
    },
    cwd,
    env: options?.env ?? {},
  };
  return {
    io,
    text: () => ({ stdout, stderr }),
  };
}

describe("main", () => {
  it("exits 0 when the tree is clean", async () => {
    const cwd = await tempDir();
    await writeTree(cwd, { "AGENTS.md": clean });
    const cap = capture(cwd);
    expect(await main([], cap.io)).toBe(0);
    const { stdout, stderr } = cap.text();
    expect(stdout).toContain("✔ 1 AGENTS.md file checked, no problems found.");
    expect(stdout.includes("\u001b")).toBe(false);
    expect(stderr).toBe("");
  });

  it("exits 1 when there is an error", async () => {
    const cwd = await tempDir();
    await writeTree(cwd, { "AGENTS.md": "" });
    const cap = capture(cwd);
    expect(await main([], cap.io)).toBe(1);
    const { stdout, stderr } = cap.text();
    expect(stdout).toContain("no-empty-file");
    expect(stdout).toContain("1 error");
    expect(stderr).toBe("");
  });

  it("exits 1 when warnings exceed --max-warnings and 0 when they do not", async () => {
    const cwd = await tempDir();
    await writeTree(cwd, { "AGENTS.md": "# Title\n\nTODO: write this\n" });
    const over = capture(cwd);
    expect(await main(["--max-warnings", "0"], over.io)).toBe(1);
    expect(over.text().stdout).toContain("no-placeholder");

    const under = capture(cwd);
    expect(await main(["--max-warnings", "1"], under.io)).toBe(0);

    const cleanDir = await tempDir();
    await writeTree(cleanDir, { "AGENTS.md": clean });
    const none = capture(cleanDir);
    expect(await main(["--max-warnings", "0"], none.io)).toBe(0);
  });

  it("rejects a non-integer --max-warnings", async () => {
    const cwd = await tempDir();
    const cap = capture(cwd);
    expect(await main(["--max-warnings", "1.5"], cap.io)).toBe(2);
    expect(cap.text().stderr).toMatch(/^agentsmd-lint: --max-warnings must be an integer/);
  });

  it("prints JSON that parses", async () => {
    const cwd = await tempDir();
    await writeTree(cwd, { "AGENTS.md": "# Title\n\nSee [missing](missing.md).\n\nTODO: write this\n" });
    const cap = capture(cwd);
    expect(await main(["--json"], cap.io)).toBe(1);
    const parsed = JSON.parse(cap.text().stdout) as {
      version: number;
      errorCount: number;
      warningCount: number;
      files: { path: string; diagnostics: { ruleId: string }[] }[];
    };
    expect(parsed.version).toBe(1);
    expect(parsed.errorCount).toBe(1);
    expect(parsed.warningCount).toBe(1);
    expect(parsed.files[0]?.path).toBe("AGENTS.md");
    expect(parsed.files[0]?.diagnostics.map((item) => item.ruleId).sort()).toEqual(["no-broken-links", "no-placeholder"]);
    expect(cap.text().stderr).toBe("");
  });

  it("lets the last of --json and --format win", async () => {
    const cwd = await tempDir();
    await writeTree(cwd, { "AGENTS.md": clean });
    const asText = capture(cwd);
    expect(await main(["--json", "--format", "text"], asText.io)).toBe(0);
    expect(asText.text().stdout).toContain("no problems found");
    expect(() => JSON.parse(asText.text().stdout)).toThrow();

    const asJson = capture(cwd);
    expect(await main(["--format", "text", "--json"], asJson.io)).toBe(0);
    expect(JSON.parse(asJson.text().stdout)).toMatchObject({ version: 1, errorCount: 0 });
  });

  it("prints GitHub workflow commands", async () => {
    const cwd = await tempDir();
    await writeTree(cwd, { "pkg/AGENTS.md": "" });
    const cap = capture(cwd);
    expect(await main(["--format", "github"], cap.io)).toBe(1);
    expect(cap.text().stdout).toContain("::error file=pkg/AGENTS.md,line=1,col=1,title=agentsmd-lint (no-empty-file)::");
    expect(cap.text().stderr).toBe("");
  });

  it("lists every rule with its default severity", async () => {
    const cwd = await tempDir();
    const cap = capture(cwd);
    expect(await main(["--list-rules"], cap.io)).toBe(0);
    const { stdout, stderr } = cap.text();
    for (const rule of rules) {
      expect(stdout).toContain(rule.id);
      expect(stdout).toContain(rule.defaultSeverity);
      expect(stdout).toContain(rule.description);
    }
    expect(stderr).toBe("");
  });

  it("prints the package version", async () => {
    const cwd = await tempDir();
    const cap = capture(cwd);
    expect(await main(["--version"], cap.io)).toBe(0);
    expect(cap.text().stdout).toBe(`${pkg.version}\n`);
    expect(cap.text().stderr).toBe("");
  });

  it("prints help", async () => {
    const cwd = await tempDir();
    const cap = capture(cwd);
    expect(await main(["-h"], cap.io)).toBe(0);
    const { stdout, stderr } = cap.text();
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("doctor");
    expect(stdout).toContain("--max-warnings");
    expect(stdout).toContain(".agentsmd-lint.json");
    expect(stdout).toContain("agentsmd-lint.config.json");
    expect(stderr).toBe("");
  });

  it("exits 2 on an unknown flag", async () => {
    const cwd = await tempDir();
    const cap = capture(cwd);
    expect(await main(["--not-a-real-flag"], cap.io)).toBe(2);
    expect(cap.text().stderr).toMatch(/^agentsmd-lint: /);
    expect(cap.text().stderr.toLowerCase()).toContain("unknown");
    expect(cap.text().stdout).toBe("");
  });

  it("exits 2 when the config file is missing", async () => {
    const cwd = await tempDir();
    const cap = capture(cwd);
    expect(await main(["--config", "missing.json"], cap.io)).toBe(2);
    expect(cap.text().stderr).toMatch(/^agentsmd-lint: Cannot read config file /);
    expect(cap.text().stderr).toContain("missing.json");
  });

  it("exits 2 for an invalid --format", async () => {
    const cwd = await tempDir();
    const cap = capture(cwd);
    expect(await main(["--format", "xml"], cap.io)).toBe(2);
    expect(cap.text().stderr).toContain('Invalid value for --format: "xml"');
  });

  it("hides warnings with --quiet without ignoring them for --max-warnings", async () => {
    const cwd = await tempDir();
    await writeTree(cwd, { "AGENTS.md": "# Title\n\nTODO: write this\n" });
    const quiet = capture(cwd);
    expect(await main(["--quiet"], quiet.io)).toBe(0);
    expect(quiet.text().stdout).toContain("no problems found");
    expect(quiet.text().stdout).not.toContain("TODO");
    expect(quiet.text().stdout).not.toContain("no-placeholder");

    const limited = capture(cwd);
    expect(await main(["--quiet", "--max-warnings", "0"], limited.io)).toBe(1);
    expect(limited.text().stdout).not.toContain("no-placeholder");
  });

  it("keeps warnings in JSON when --quiet is set", async () => {
    const cwd = await tempDir();
    await writeTree(cwd, { "AGENTS.md": "# Title\n\nTODO: write this\n" });
    const cap = capture(cwd);
    expect(await main(["--quiet", "--json"], cap.io)).toBe(0);
    const parsed = JSON.parse(cap.text().stdout) as { warningCount: number; files: { diagnostics: { ruleId: string }[] }[] };
    expect(parsed.warningCount).toBe(1);
    expect(parsed.files[0]?.diagnostics[0]?.ruleId).toBe("no-placeholder");
  });

  it("exits 2 when a path does not exist", async () => {
    const cwd = await tempDir();
    const cap = capture(cwd);
    expect(await main(["missing.md"], cap.io)).toBe(2);
    expect(cap.text().stderr).toBe("agentsmd-lint: Path not found: missing.md\n");
  });

  it("reports doctor findings and exits 0", async () => {
    const cwd = await tempDir();
    await writeTree(cwd, { "AGENTS.md": clean, ".git/HEAD": "ref: refs/heads/main\n" });
    const cap = capture(cwd);
    expect(await main(["doctor"], cap.io)).toBe(0);
    const { stdout, stderr } = cap.text();
    expect(stdout).toContain("OpenAI Codex");
    expect(stdout).toContain("AGENTS.md is ignored by Claude Code: no CLAUDE.md imports it");
    expect(stdout).toContain("✔");
    expect(stdout).toContain("⚠");
    expect(stdout.includes("\u001b")).toBe(false);
    expect(stderr).toBe("");

    const json = capture(cwd);
    expect(await main(["doctor", "--json", "."], json.io)).toBe(0);
    const parsed = JSON.parse(json.text().stdout) as { version: number; command: string; directory: string; agents: { id: string }[] };
    expect(parsed.version).toBe(1);
    expect(parsed.command).toBe("doctor");
    expect(parsed.directory).toBe(toPosix(cwd));
    expect(parsed.directory.includes("\\")).toBe(false);
    expect(parsed.agents.map((item) => item.id)).toEqual(["codex", "claude", "cursor", "copilot", "gemini"]);
  });

  it("colors doctor text and honors --no-color", async () => {
    const cwd = await tempDir();
    await writeTree(cwd, { "AGENTS.md": clean });
    const colored = capture(cwd, { tty: true });
    expect(await main(["doctor", "--color"], colored.io)).toBe(0);
    expect(colored.text().stdout).toContain("\u001b[32m✔");
    expect(colored.text().stdout).toContain("\u001b[33m⚠");

    const plain = capture(cwd, { tty: true });
    expect(await main(["doctor", "--color", "--no-color"], plain.io)).toBe(0);
    expect(plain.text().stdout.includes("\u001b")).toBe(false);

    const noColorEnv = capture(cwd, { tty: true, env: { NO_COLOR: "1" } });
    expect(await main(["doctor"], noColorEnv.io)).toBe(0);
    expect(noColorEnv.text().stdout.includes("\u001b")).toBe(false);
  });

  it("exits 2 for a bad doctor invocation and still lints a path named ./doctor", async () => {
    const cwd = await tempDir();
    await writeTree(cwd, { "AGENTS.md": clean, doctor: clean });
    const missing = capture(cwd);
    expect(await main(["doctor", "missing"], missing.io)).toBe(2);
    expect(missing.text().stderr).toBe("agentsmd-lint: Path not found: missing\n");

    const file = capture(cwd);
    expect(await main(["doctor", "AGENTS.md"], file.io)).toBe(2);
    expect(file.text().stderr).toContain("doctor expects a directory");

    const extra = capture(cwd);
    expect(await main(["doctor", "a", "b"], extra.io)).toBe(2);
    expect(extra.text().stderr).toContain("doctor accepts at most one directory");

    const github = capture(cwd);
    expect(await main(["doctor", "--format", "github"], github.io)).toBe(2);
    expect(github.text().stderr).toContain("doctor does not support --format github");

    const lintNamed = capture(cwd);
    expect(await main(["./doctor"], lintNamed.io)).toBe(0);
    expect(lintNamed.text().stdout).toContain("no problems found");
    expect(lintNamed.text().stdout).not.toContain("Repo root");
  });
});
