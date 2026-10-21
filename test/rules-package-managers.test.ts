import { describe, expect, it } from "vitest";
import { forRule, lintAt, tempDir, writeTree } from "./helpers.js";

async function repo(files: Record<string, string>): Promise<string> {
  const root = await tempDir();
  await writeTree(root, files);
  return root;
}

function managers(root: string, source: string) {
  return forRule(lintAt(root, "AGENTS.md", source), "consistent-package-manager");
}

describe("consistent-package-manager", () => {
  it("accepts a single manager and matching lockfile", async () => {
    const root = await repo({ "package-lock.json": "{}\n", "npm-shrinkwrap.json": "{}\n" });
    const source = "# Setup\n\n`npm install` then `npx tsc`.\n";
    expect(managers(root, source)).toEqual([]);
  });

  it("accepts pnpm, yarn, and bun with their own lockfiles", async () => {
    const pnpm = await repo({ "pnpm-lock.yaml": "lock\n" });
    expect(managers(pnpm, "# Setup\n\n`pnpm install` and `pnpx tsc`.\n")).toEqual([]);

    const yarn = await repo({ "yarn.lock": "lock\n" });
    expect(managers(yarn, "# Setup\n\n`yarn install`\n")).toEqual([]);

    const bun = await repo({ "bun.lock": "lock\n" });
    expect(managers(bun, "# Setup\n\n`bun install` and `bunx tsc`.\n")).toEqual([]);
  });

  it("warns when instructions mix two managers", async () => {
    const root = await repo({});
    const findings = managers(root, "# Setup\n\n```bash\nnpm test\npnpm test\nyarn test\n```\n");
    expect(findings).toEqual([
      {
        ruleId: "consistent-package-manager",
        severity: "warn",
        message: "Instructions mix npm and pnpm; agents may run the wrong one.",
        line: 5,
        column: 1,
      },
    ]);
  });

  it("warns when commands disagree with the only lockfile", async () => {
    const root = await repo({ "pnpm-lock.yaml": "lock\n" });
    const findings = managers(root, "# Setup\n\n`npm install`\n");
    expect(findings).toEqual([
      {
        ruleId: "consistent-package-manager",
        severity: "warn",
        message: "Instructions use npm but the repo has pnpm-lock.yaml.",
        line: 3,
        column: 2,
      },
    ]);
  });

  it("names every lockfile when they all belong to the other manager", async () => {
    const root = await repo({ "bun.lockb": "bin\n", "bun.lock": "txt\n" });
    const findings = managers(root, "# Setup\n\n`npm ci`\n");
    expect(findings[0]?.message).toBe("Instructions use npm but the repo has bun.lockb and bun.lock.");
  });

  it("does not warn about lockfiles when more than one manager is locked", async () => {
    const root = await repo({ "package-lock.json": "{}\n", "yarn.lock": "lock\n" });
    expect(managers(root, "# Setup\n\n`npm install`\n")).toEqual([]);
  });

  it("ignores package-manager words outside code and inside non-shell fences", async () => {
    const root = await repo({ "pnpm-lock.yaml": "lock\n" });
    const source = `# Setup

Use npm every day.

\`\`\`js
npm install
pnpm install
\`\`\`
`;
    expect(managers(root, source)).toEqual([]);
  });

  it("reads a shell pipeline as separate commands", async () => {
    const root = await repo({});
    const findings = managers(root, "# Setup\n\n`npm test && pnpm build`\n");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("mix npm and pnpm");
  });

  it("accepts quoted manager tokens", async () => {
    const root = await repo({ "yarn.lock": "" });
    expect(managers(root, "# Setup\n\n`'yarn' install`\n")).toEqual([]);
  });
});
