import path from "node:path";
import { describe, expect, it } from "vitest";
import { findAgentFiles } from "../src/discover.js";
import { tempDir, writeTree } from "./helpers.js";

function rels(root: string, files: string[]): string[] {
  return files.map((file) => path.relative(root, file).split(path.sep).join("/"));
}

async function fixture(): Promise<string> {
  const root = await tempDir();
  await writeTree(root, {
    "AGENTS.md": "# root\n",
    "AGENTS.override.md": "# override\n",
    "README.md": "not an agent file\n",
    "a/AGENTS.md": "# a\n",
    "a/AGENTS.override.md": "# a override\n",
    "a/deep/AGENTS.md": "# deep\n",
    "b/AGENTS.override.md": "# b\n",
    "node_modules/pkg/AGENTS.md": "# dep\n",
    ".git/AGENTS.md": "# git\n",
    "docs/AGENTS.md": "# docs\n",
    "docs/internal/AGENTS.md": "# internal\n",
  });
  return root;
}

describe("findAgentFiles", () => {
  it("finds root and nested AGENTS.md and AGENTS.override.md", async () => {
    const root = await fixture();
    const found = rels(root, await findAgentFiles(root));
    expect(found).toContain("AGENTS.md");
    expect(found).toContain("AGENTS.override.md");
    expect(found).toContain("a/AGENTS.md");
    expect(found).toContain("a/deep/AGENTS.md");
    expect(found).toContain("b/AGENTS.override.md");
    expect(found).not.toContain("README.md");
  });

  it("skips node_modules and .git", async () => {
    const root = await fixture();
    const found = rels(root, await findAgentFiles(root));
    expect(found.some((file) => file.includes("node_modules"))).toBe(false);
    expect(found.some((file) => file.startsWith(".git"))).toBe(false);
  });

  it("orders shallow paths first, then by locale", async () => {
    const root = await fixture();
    expect(rels(root, await findAgentFiles(root))).toEqual([
      "AGENTS.md",
      "AGENTS.override.md",
      "a/AGENTS.md",
      "a/AGENTS.override.md",
      "b/AGENTS.override.md",
      "docs/AGENTS.md",
      "a/deep/AGENTS.md",
      "docs/internal/AGENTS.md",
    ]);
  });

  it("ignores a directory name wherever it appears", async () => {
    const root = await fixture();
    const found = rels(root, await findAgentFiles(root, ["internal"]));
    expect(found).not.toContain("docs/internal/AGENTS.md");
    expect(found).toContain("docs/AGENTS.md");
    expect(found).toContain("a/deep/AGENTS.md");
  });

  it("ignores a path prefix, including ./ and a trailing slash", async () => {
    const root = await fixture();
    const found = rels(root, await findAgentFiles(root, ["./docs/internal/"]));
    expect(found).not.toContain("docs/internal/AGENTS.md");
    expect(found).toContain("docs/AGENTS.md");
  });

  it("does not treat a directory-name ignore as a substring", async () => {
    const root = await fixture();
    const found = rels(root, await findAgentFiles(root, ["doc"]));
    expect(found).toContain("docs/AGENTS.md");
    expect(found).toContain("docs/internal/AGENTS.md");
  });

  it("skips a nested directory whose name is ignored", async () => {
    const root = await fixture();
    const found = rels(root, await findAgentFiles(root, ["deep"]));
    expect(found).not.toContain("a/deep/AGENTS.md");
    expect(found).toContain("a/AGENTS.md");
  });

  it("returns an empty list when the root cannot be read", async () => {
    const root = await tempDir();
    expect(await findAgentFiles(path.join(root, "missing"))).toEqual([]);
  });
});
