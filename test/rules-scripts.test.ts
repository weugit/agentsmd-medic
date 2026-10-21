import { describe, expect, it } from "vitest";
import { forRule, lintAt, tempDir, writeTree } from "./helpers.js";

const pkg = JSON.stringify({
  scripts: { build: "tsc", test: "vitest", lint: "eslint ." },
});

async function repo(extra: Record<string, string> = {}): Promise<string> {
  const root = await tempDir();
  await writeTree(root, {
    "package.json": pkg,
    Makefile: "build:\n\ttrue\n\ntest:\n\ttrue\n",
    ...extra,
  });
  return root;
}

function scripts(root: string, source: string, rel = "AGENTS.md") {
  return forRule(lintAt(root, rel, source), "no-missing-scripts");
}

describe("no-missing-scripts", () => {
  it("accepts npm, pnpm, yarn, and bun scripts that exist", async () => {
    const root = await repo();
    const source = `# Setup

\`npm run build\`
\`npm test\`
\`npm t\`

\`\`\`bash
pnpm run lint
yarn build
bun run test
\`\`\`
`;
    expect(scripts(root, source)).toEqual([]);
  });

  it("flags a missing npm script from a code span", async () => {
    const root = await repo();
    const findings = scripts(root, "# Setup\n\nRun `npm run ship`.\n");
    expect(findings).toEqual([
      {
        ruleId: "no-missing-scripts",
        severity: "warn",
        message: "Script `ship` is not defined in package.json.",
        line: 3,
        column: 6,
      },
    ]);
  });

  it("flags npm test when the test script is absent", async () => {
    const root = await tempDir();
    await writeTree(root, { "package.json": JSON.stringify({ scripts: { build: "tsc" } }) });
    const findings = scripts(root, "# Setup\n\n`npm test`\n");
    expect(findings[0]?.message).toBe("Script `test` is not defined in package.json.");
  });

  it("treats a non-builtin pnpm or yarn word as a script", async () => {
    const root = await repo();
    expect(scripts(root, "# Setup\n\n`pnpm install`\n")).toEqual([]);
    const findings = scripts(root, "# Setup\n\n`yarn ship`\n");
    expect(findings[0]?.message).toBe("Script `ship` is not defined in package.json.");
  });

  it("flags a missing Make target and accepts one that exists", async () => {
    const root = await repo();
    expect(scripts(root, "# Setup\n\n`make build`\n")).toEqual([]);
    const findings = scripts(root, "# Setup\n\n```bash\nmake ship\n```\n");
    expect(findings).toEqual([
      {
        ruleId: "no-missing-scripts",
        severity: "warn",
        message: "Make target `ship` is not defined in Makefile.",
        line: 4,
        column: 1,
      },
    ]);
  });

  it("skips commands aimed at another workspace", async () => {
    const root = await repo();
    const source = "# Setup\n\n`pnpm --filter web build`\n`npm run build -w app`\n";
    expect(scripts(root, source)).toEqual([]);
  });

  it("ignores shell comments and non-shell fences", async () => {
    const root = await repo();
    const source = `# Setup

\`\`\`bash
# npm run ship
make build
\`\`\`

\`\`\`js
npm run ship
make ship
\`\`\`
`;
    expect(scripts(root, source)).toEqual([]);
  });

  it("stays quiet when there is no package.json or Makefile", async () => {
    const root = await tempDir();
    const source = "# Setup\n\n`npm run ship` and `make ship`.\n";
    expect(scripts(root, source)).toEqual([]);
  });

  it("uses the nearest package.json, not a script that exists only at the root", async () => {
    const root = await repo({ "pkg/package.json": JSON.stringify({ scripts: { start: "node ." } }) });
    const findings = scripts(root, "# Setup\n\n`npm run build`\n", "pkg/AGENTS.md");
    expect(findings[0]?.message).toBe("Script `build` is not defined in pkg/package.json.");
  });

  it("uses the nearest Makefile", async () => {
    const root = await repo({ "pkg/Makefile": "start:\n\ttrue\n" });
    const findings = scripts(root, "# Setup\n\n`make build`\n", "pkg/AGENTS.md");
    expect(findings[0]?.message).toBe("Make target `build` is not defined in pkg/Makefile.");
  });

  it("does not treat arguments after -- as extra scripts", async () => {
    const root = await repo();
    expect(scripts(root, "# Setup\n\n`npm test -- --coverage`\n")).toEqual([]);
  });

  it("strips a leading prompt in a shell block", async () => {
    const root = await repo();
    expect(scripts(root, "# Setup\n\n```console\n$ npm run build\n```\n")).toEqual([]);
    const findings = scripts(root, "# Setup\n\n```sh\n$ npm run ship\n```\n");
    expect(findings[0]?.message).toContain("Script `ship`");
  });
});
