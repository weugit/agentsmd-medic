import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLAUDE_AGENTS_IGNORED, CLAUDE_LOCAL_WARNING, CODEX_PROJECT_DOC_MAX_BYTES, CURSOR_LEGACY_WARNING, GEMINI_ONLY_AGENTS_WARNING } from "../src/agents.js";
import {
  agentsMdImportSpec,
  claudeFileImportsAgentsMd,
  diagnose,
  findGitRoot,
  formatDoctorJson,
  formatDoctorText,
  type DoctorReport,
} from "../src/doctor.js";
import { tempDir, writeTree } from "./helpers.js";

function at(root: string, rel: string): string {
  return path.join(root, ...rel.split("/"));
}

const agents = "# Notes\n\nRun the tests.\n";

function agent(report: Awaited<ReturnType<typeof diagnose>>, id: string) {
  const found = report.agents.find((item) => item.id === id);
  if (!found) throw new Error(`missing agent ${id}`);
  return found;
}

describe("claude import lines", () => {
  it("accepts @AGENTS.md, @./AGENTS.md, and other relative paths", () => {
    expect(agentsMdImportSpec("@AGENTS.md")).toBe("AGENTS.md");
    expect(agentsMdImportSpec("  @./AGENTS.md")).toBe("./AGENTS.md");
    expect(agentsMdImportSpec("@../AGENTS.md")).toBe("../AGENTS.md");
    expect(agentsMdImportSpec("@docs/AGENTS.md")).toBe("docs/AGENTS.md");
    expect(agentsMdImportSpec("@./AGENTS.md.")).toBe("./AGENTS.md");
  });

  it("rejects prose, URLs, and fenced examples", () => {
    expect(agentsMdImportSpec("See @AGENTS.md")).toBeUndefined();
    expect(agentsMdImportSpec("@https://example.com/AGENTS.md")).toBeUndefined();
    expect(agentsMdImportSpec("@README.md")).toBeUndefined();
    const fenced = "# Notes\n\n```md\n@AGENTS.md\n```\n\nNo import here.\n";
    expect(claudeFileImportsAgentsMd(fenced)).toBe(false);
    expect(claudeFileImportsAgentsMd("# Notes\n\n@AGENTS.md\n")).toBe(true);
    expect(claudeFileImportsAgentsMd("# Notes\n\n@./AGENTS.md\n")).toBe(true);
  });
});

describe("diagnose", () => {
  it("finds the git root and concatenates Codex files root to leaf", async () => {
    const root = await tempDir();
    await writeTree(root, {
      ".git/HEAD": "ref: refs/heads/main\n",
      "AGENTS.md": agents,
      "AGENTS.override.md": "# Override\n\nUse this.\n",
      "pkg/AGENTS.md": "# Nested agents\n\nSkip me when override exists.\n",
      "pkg/AGENTS.override.md": "# Pkg override\n\nCloser.\n",
      "other/AGENTS.md": "# Sibling\n\nNot on the path.\n",
      "node_modules/AGENTS.md": "# Dep\n\nSkip.\n",
    });
    const report = await diagnose(`${at(root, "pkg")}`);
    expect(report.root).toBe(root);
    expect(report.directory).toBe(`${at(root, "pkg")}`);
    expect(findGitRoot(`${at(root, "pkg")}`)).toBe(root);
    const codex = agent(report, "codex");
    expect(codex.files.map((file) => file.path)).toEqual(["AGENTS.override.md", "pkg/AGENTS.override.md"]);
    expect(codex.warnings).toEqual([]);
    expect(codex.notes.some((note) => note.includes("project_doc_max_bytes"))).toBe(true);
    const cursor = agent(report, "cursor");
    expect(cursor.files.map((file) => file.path)).toEqual(["AGENTS.md", "pkg/AGENTS.md"]);
    expect(cursor.files.map((file) => file.path)).not.toContain("other/AGENTS.md");
    expect(cursor.files.map((file) => file.path)).not.toContain("node_modules/AGENTS.md");
  });

  it("uses the directory itself when no ancestor contains .git", async () => {
    const root = await tempDir();
    await writeTree(root, { "AGENTS.md": agents });
    const report = await diagnose(root);
    expect(report.root).toBe(root);
    expect(agent(report, "codex").files.map((file) => file.path)).toEqual(["AGENTS.md"]);
  });

  it("treats a .git file as the repo root", async () => {
    const root = await tempDir();
    await writeTree(root, { ".git": "gitdir: /elsewhere\n", "nested/AGENTS.md": agents });
    const report = await diagnose(`${at(root, "nested")}`);
    expect(report.root).toBe(root);
    expect(agent(report, "codex").files.map((file) => file.path)).toEqual(["nested/AGENTS.md"]);
  });

  it("warns when Codex project docs exceed the default cap", async () => {
    const root = await tempDir();
    const body = `# Big\n\n${"x".repeat(CODEX_PROJECT_DOC_MAX_BYTES)}\n`;
    await writeTree(root, { ".git/HEAD": "ref: refs/heads/main\n", "AGENTS.md": body });
    const report = await diagnose(root);
    const codex = agent(report, "codex");
    expect(codex.status).toBe("warn");
    expect(codex.warnings[0]).toContain("project_doc_max_bytes");
    expect(codex.warnings[0]).toContain(String(CODEX_PROJECT_DOC_MAX_BYTES));
    const bytes = codex.files[0]?.bytes ?? 0;
    expect(bytes).toBeGreaterThan(CODEX_PROJECT_DOC_MAX_BYTES);
    expect(codex.warnings[0]).toContain(String(bytes));
  });

  it("keeps Codex under the cap when the combined size equals 32 KiB", async () => {
    const root = await tempDir();
    await writeTree(root, { "AGENTS.md": "x".repeat(CODEX_PROJECT_DOC_MAX_BYTES) });
    const codex = agent(await diagnose(root), "codex");
    expect(codex.warnings).toEqual([]);
    expect(codex.notes.some((note) => note.includes("within the default 32 KiB cap"))).toBe(true);
  });

  it("warns that Claude ignores AGENTS.md unless CLAUDE.md imports it", async () => {
    const root = await tempDir();
    await writeTree(root, {
      ".git/HEAD": "ref: refs/heads/main\n",
      "AGENTS.md": agents,
      "pkg/AGENTS.md": agents,
      "pkg/CLAUDE.md": "# Claude\n\n```\n@AGENTS.md\n```\n\nNo real import.\n",
      "pkg/CLAUDE.local.md": "@AGENTS.md\n",
    });
    const report = await diagnose(`${at(root, "pkg")}`);
    const claude = agent(report, "claude");
    expect(claude.warnings).toContain(CLAUDE_AGENTS_IGNORED);
    expect(claude.warnings).toContain(CLAUDE_LOCAL_WARNING);
    expect(claude.files.find((file) => file.path === "pkg/CLAUDE.local.md")?.note).toBe("personal, git-ignored");
    expect(claude.files.find((file) => file.path === "AGENTS.md")?.loaded).toBe(false);

    await writeTree(root, { "pkg/CLAUDE.md": "# Claude\n\n@../AGENTS.md\n" });
    const imported = agent(await diagnose(`${at(root, "pkg")}`), "claude");
    expect(imported.warnings).not.toContain(CLAUDE_AGENTS_IGNORED);
    expect(imported.warnings).toContain(CLAUDE_LOCAL_WARNING);
    expect(imported.notes.some((note) => note.includes("imports AGENTS.md"))).toBe(true);
    expect(imported.files.find((file) => file.path === "AGENTS.md")?.loaded).toBe(true);
    expect(imported.files.find((file) => file.path === "pkg/CLAUDE.md")?.note).toBe("imports AGENTS.md");
  });

  it("warns when AGENTS.md exists and there is no CLAUDE.md at all", async () => {
    const root = await tempDir();
    await writeTree(root, { "AGENTS.md": agents });
    const claude = agent(await diagnose(root), "claude");
    expect(claude.warnings).toEqual([CLAUDE_AGENTS_IGNORED]);
    expect(claude.notes.some((note) => note.includes("No CLAUDE.md"))).toBe(true);
  });

  it("accepts @AGENTS.md and @./AGENTS.md in CLAUDE.md", async () => {
    const root = await tempDir();
    await writeTree(root, { "AGENTS.md": agents, "CLAUDE.md": "@./AGENTS.md\n" });
    expect(agent(await diagnose(root), "claude").warnings).not.toContain(CLAUDE_AGENTS_IGNORED);
    await writeTree(root, { "CLAUDE.md": "@AGENTS.md\n" });
    expect(agent(await diagnose(root), "claude").warnings).not.toContain(CLAUDE_AGENTS_IGNORED);
  });

  it("lists Cursor rules and flags legacy .cursorrules", async () => {
    const root = await tempDir();
    await writeTree(root, {
      ".git/HEAD": "ref: refs/heads/main\n",
      "AGENTS.md": agents,
      ".cursorrules": "legacy\n",
      ".cursor/rules/style.mdc": "---\nalwaysApply: true\n---\n",
      ".cursor/rules/nested/extra.mdc": "# Extra\n",
      "pkg/.cursor/rules/local.mdc": "# Local\n",
      "other/.cursor/rules/skip.mdc": "# Skip\n",
    });
    const cursor = agent(await diagnose(`${at(root, "pkg")}`), "cursor");
    expect(cursor.warnings).toEqual([CURSOR_LEGACY_WARNING]);
    expect(cursor.files.map((file) => file.path)).toEqual([
      ".cursorrules",
      "AGENTS.md",
      ".cursor/rules/style.mdc",
      ".cursor/rules/nested/extra.mdc",
      "pkg/.cursor/rules/local.mdc",
    ]);
    expect(cursor.files.find((file) => file.path === ".cursorrules")?.note).toBe("deprecated");
  });

  it("lists Copilot repository and path instructions plus AGENTS.md", async () => {
    const root = await tempDir();
    await writeTree(root, {
      ".git/HEAD": "ref: refs/heads/main\n",
      "AGENTS.md": agents,
      ".github/copilot-instructions.md": "# Repo\n",
      ".github/instructions/ts.instructions.md": "# TS\n",
      ".github/instructions/sub/api.instructions.md": "# API\n",
      ".github/instructions/readme.md": "# Not instructions\n",
      "pkg/.github/copilot-instructions.md": "# Pkg\n",
      "other/.github/copilot-instructions.md": "# Other\n",
    });
    const copilot = agent(await diagnose(`${at(root, "pkg")}`), "copilot");
    expect(copilot.warnings).toEqual([]);
    expect(copilot.files.map((file) => file.path)).toEqual([
      "AGENTS.md",
      ".github/copilot-instructions.md",
      ".github/instructions/ts.instructions.md",
      "pkg/.github/copilot-instructions.md",
      ".github/instructions/sub/api.instructions.md",
    ]);
    expect(copilot.notes[0]).toContain(".github/copilot-instructions.md");
    expect(copilot.notes[0]).toContain(".github/instructions/*.instructions.md");
  });

  it("warns when Gemini would see only AGENTS.md", async () => {
    const root = await tempDir();
    await writeTree(root, { "AGENTS.md": agents, "GEMINI.md": "# Gemini\n\nUse this.\n" });
    const both = agent(await diagnose(root), "gemini");
    expect(both.warnings).toEqual([]);
    expect(both.notes.some((note) => note.includes("AGENTS.md is not loaded unless context.fileName includes it."))).toBe(true);
    expect(both.files.find((file) => file.path === "GEMINI.md")?.loaded).toBe(true);
    expect(both.files.find((file) => file.path === "AGENTS.md")?.loaded).toBe(false);

    const only = await tempDir();
    await writeTree(only, { "AGENTS.md": agents });
    const gemini = agent(await diagnose(only), "gemini");
    expect(gemini.warnings).toEqual([GEMINI_ONLY_AGENTS_WARNING]);
    expect(gemini.status).toBe("warn");
  });

  it("loads AGENTS.md for Gemini when context.fileName includes it", async () => {
    const root = await tempDir();
    await writeTree(root, {
      ".git/HEAD": "ref: refs/heads/main\n",
      "AGENTS.md": agents,
      ".gemini/settings.json": JSON.stringify({ context: { fileName: "AGENTS.md" } }),
      "pkg/.gemini/settings.json": JSON.stringify({ context: { fileName: ["GEMINI.md"] } }),
    });
    const atRoot = agent(await diagnose(root), "gemini");
    expect(atRoot.warnings).toEqual([]);
    expect(atRoot.notes[0]).toContain("context.fileName in .gemini/settings.json is AGENTS.md");
    expect(atRoot.files.find((file) => file.path === "AGENTS.md")?.loaded).toBe(true);

    const closer = agent(await diagnose(`${at(root, "pkg")}`), "gemini");
    expect(closer.notes[0]).toContain("pkg/.gemini/settings.json is GEMINI.md");
    expect(closer.warnings).toContain(GEMINI_ONLY_AGENTS_WARNING);
  });

  it("reports an unreadable Gemini settings file and still applies the default", async () => {
    const root = await tempDir();
    await writeTree(root, { ".gemini/settings.json": "{", "AGENTS.md": agents });
    const gemini = agent(await diagnose(root), "gemini");
    expect(gemini.warnings[0]).toContain("Could not parse .gemini/settings.json");
    expect(gemini.warnings).toContain(GEMINI_ONLY_AGENTS_WARNING);
  });

  it("prints text with markers and JSON", async () => {
    const root = await tempDir();
    await writeTree(root, { "AGENTS.md": agents });
    const report = await diagnose(root);
    const plain = formatDoctorText(report);
    expect(plain).toContain("OpenAI Codex");
    expect(plain).toContain("Claude Code");
    expect(plain).toContain("Cursor");
    expect(plain).toContain("GitHub Copilot");
    expect(plain).toContain("Gemini CLI");
    expect(plain).toContain("✔");
    expect(plain).toContain("⚠");
    expect(plain).toContain(CLAUDE_AGENTS_IGNORED);
    expect(plain.includes("\u001b")).toBe(false);

    const colored = formatDoctorText(report, { color: true });
    expect(colored).toContain("\u001b[32m✔");
    expect(colored).toContain("\u001b[33m⚠");
    expect(colored).toContain("\u001b[1mOpenAI Codex");
    expect(colored).toContain(CLAUDE_AGENTS_IGNORED);

    const parsed = JSON.parse(formatDoctorJson(report)) as { version: number; command: string; directory: string; root: string; agents: { id: string; docsUrl: string }[] };
    expect(parsed.version).toBe(1);
    expect(parsed.command).toBe("doctor");
    expect(parsed.directory).toBe(report.directory.split(path.sep).join("/"));
    expect(parsed.root).toBe(report.root.split(path.sep).join("/"));
    expect(parsed.agents.map((item) => item.id)).toEqual(["codex", "claude", "cursor", "copilot", "gemini"]);
    for (const item of parsed.agents) expect(item.docsUrl).toMatch(/^https:\/\//);
    expect(plain).toContain(`Directory: ${parsed.directory}`);
    expect(plain).toContain(`Repo root: ${parsed.root}`);
  });

  it("prints Windows-style absolute paths with forward slashes", () => {
    const report: DoctorReport = {
      version: 1,
      command: "doctor",
      directory: "C:\\repo\\pkg",
      root: "C:\\repo",
      agents: [
        {
          id: "codex",
          name: "OpenAI Codex",
          docsUrl: "https://example.com",
          status: "ok",
          files: [{ path: "pkg\\AGENTS.md", bytes: 4, role: "codex-project-doc", loaded: true }],
          notes: [],
          warnings: [],
        },
      ],
    };
    expect(formatDoctorText(report)).toContain("Directory: C:/repo/pkg");
    expect(formatDoctorText(report)).toContain("Repo root: C:/repo");
    expect(formatDoctorText(report)).toContain("pkg/AGENTS.md");
    const parsed = JSON.parse(formatDoctorJson(report)) as { directory: string; root: string; agents: { files: { path: string }[] }[] };
    expect(parsed.directory).toBe("C:/repo/pkg");
    expect(parsed.root).toBe("C:/repo");
    expect(parsed.agents[0]?.files[0]?.path).toBe("pkg/AGENTS.md");
  });
});
