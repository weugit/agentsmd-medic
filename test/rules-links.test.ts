import path from "node:path";
import { describe, expect, it } from "vitest";
import { forRule, lintAt, tempDir, writeTree } from "./helpers.js";

async function repo(): Promise<string> {
  const root = await tempDir();
  await writeTree(root, {
    "guide.md": "# Install\n\nSteps.\n",
    "docs/extra.md": "# Extra\n\nMore.\n## Extra\n\nSecond.\n",
    "pkg/local.md": "# Local\n",
    "my file.md": "# Spaced\n",
    "package.json": "{}\n",
  });
  return root;
}

function links(root: string, rel: string, source: string) {
  return forRule(lintAt(root, rel, source), "no-broken-links");
}

describe("no-broken-links", () => {
  it("accepts a relative link that exists", async () => {
    const root = await repo();
    expect(links(root, "AGENTS.md", "# Setup\n\nSee [guide](guide.md).\n")).toEqual([]);
  });

  it("omits the resolved path when it equals the link target", async () => {
    const root = await repo();
    const source = "# Setup\n\nSee [missing](missing.md).\n";
    const findings = links(root, "AGENTS.md", source);
    expect(findings).toEqual([
      {
        ruleId: "no-broken-links",
        severity: "error",
        message: 'Broken link: "missing.md" does not exist.',
        line: 3,
        column: source.split("\n")[2]!.indexOf("[") + 1,
      },
    ]);
    expect(findings[0]?.message).not.toContain("resolved to");
  });

  it("includes the resolved path only when it differs from the target", async () => {
    const root = await repo();
    const fromRoot = links(root, "AGENTS.md", "# Setup\n\nSee [missing](./missing.md).\n");
    expect(fromRoot[0]?.message).toBe('Broken link: "./missing.md" (resolved to missing.md) does not exist.');

    const fromNested = links(root, "pkg/AGENTS.md", "# Setup\n\nSee [missing](../missing.md).\n");
    expect(fromNested[0]?.message).toBe('Broken link: "../missing.md" (resolved to missing.md) does not exist.');
  });

  it("resolves a link that points at a subdirectory", async () => {
    const root = await repo();
    const findings = links(root, "AGENTS.md", "# Setup\n\nSee [x](docs/missing.md).\n");
    expect(findings[0]?.message).toBe('Broken link: "docs/missing.md" does not exist.');
    expect(path.isAbsolute(findings[0]?.message ?? "")).toBe(false);
  });

  it("skips external and protocol-relative links", async () => {
    const root = await repo();
    const source = `# Setup

[web](https://example.com/missing.md)
[mail](mailto:dev@example.com)
[proto](//cdn.example.com/app.js)
[HTTP](HTTP://example.com/nope)
`;
    expect(links(root, "AGENTS.md", source)).toEqual([]);
  });

  it("checks in-page anchors, including case", async () => {
    const root = await repo();
    expect(links(root, "AGENTS.md", "# Setup\n\n[jump](#setup)\n[upper](#SETUP)\n")).toEqual([]);
    const missing = links(root, "AGENTS.md", "# Setup\n\n[jump](#missing)\n");
    expect(missing[0]?.message).toBe('Anchor "#missing" does not match any heading in this file.');
  });

  it("checks anchors in other markdown files and ignores them for non-markdown files", async () => {
    const root = await repo();
    expect(links(root, "AGENTS.md", "# Setup\n\n[go](guide.md#install)\n")).toEqual([]);
    const missing = links(root, "AGENTS.md", "# Setup\n\n[go](guide.md#missing)\n");
    expect(missing[0]?.message).toBe('Anchor "#missing" not found in guide.md.');
    expect(links(root, "AGENTS.md", "# Setup\n\n[pkg](package.json#scripts)\n")).toEqual([]);
  });

  it("uses the duplicate-slug suffix for the second heading", async () => {
    const root = await repo();
    expect(links(root, "AGENTS.md", "# Setup\n\nSee [extra](docs/extra.md#extra-1).\n")).toEqual([]);
    const missing = links(root, "AGENTS.md", "# Setup\n\nSee [extra](docs/extra.md#extra-2).\n");
    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toBe('Anchor "#extra-2" not found in docs/extra.md.');
  });

  it("resolves a root-relative link from the lint root", async () => {
    const root = await repo();
    expect(links(root, "pkg/AGENTS.md", "# Setup\n\nSee [guide](/guide.md).\n")).toEqual([]);
    const missing = links(root, "pkg/AGENTS.md", "# Setup\n\nSee [x](/docs/missing.md).\n");
    expect(missing[0]?.message).toBe('Broken link: "/docs/missing.md" (resolved to docs/missing.md) does not exist.');
  });

  it("decodes percent-encoded paths", async () => {
    const root = await repo();
    expect(links(root, "AGENTS.md", "# Setup\n\n[space](my%20file.md)\n")).toEqual([]);
  });

  it("reports a broken reference definition", async () => {
    const root = await repo();
    const findings = links(root, "AGENTS.md", "# Setup\n\n[guide]: ./missing.md\n");
    expect(findings[0]?.message).toBe('Broken link: "./missing.md" (resolved to missing.md) does not exist.');
  });

  it("does not report a link hidden in a code span", async () => {
    const root = await repo();
    expect(links(root, "AGENTS.md", "# Setup\n\nRun `[text](missing.md)` as shown.\n")).toEqual([]);
  });

  it("reports one diagnostic when the file and its anchor are both missing", async () => {
    const root = await repo();
    const findings = links(root, "AGENTS.md", "# Setup\n\n[x](missing.md#section)\n");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("does not exist");
  });

  it("accepts an external reference definition", async () => {
    const root = await repo();
    expect(links(root, "AGENTS.md", "# Setup\n\n[home]: https://example.com\n")).toEqual([]);
  });
});
