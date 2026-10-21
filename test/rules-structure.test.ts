import { describe, expect, it } from "vitest";
import { analyzeSize } from "../src/rules/structure.js";
import { forRule, lintSource } from "./helpers.js";

const doc = `# Setup

Install dependencies, then run the test suite.
`;

describe("no-empty-file", () => {
  it("flags an empty file and a file that is only a comment", () => {
    for (const source of ["", "   \n\n", "<!-- agents only -->"]) {
      const findings = forRule(lintSource(source), "no-empty-file");
      expect(findings).toEqual([
        {
          ruleId: "no-empty-file",
          severity: "error",
          message: "File is empty; agents will get no instructions from it.",
          line: 1,
          column: 1,
        },
      ]);
    }
  });

  it("accepts a file that has instructions outside comments", () => {
    expect(forRule(lintSource("<!-- note -->\nDo this.\n"), "no-empty-file")).toEqual([]);
    expect(forRule(lintSource(doc), "no-empty-file")).toEqual([]);
  });
});

describe("require-heading", () => {
  it("warns when prose has no heading", () => {
    const findings = forRule(lintSource("Run the tests before pushing.\n"), "require-heading");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "warn",
      line: 1,
      column: 1,
      message: "No Markdown headings found; structure instructions into sections (e.g. `## Setup`, `## Testing`).",
    });
  });

  it("accepts a heading and stays quiet on an empty file", () => {
    expect(forRule(lintSource(doc), "require-heading")).toEqual([]);
    expect(forRule(lintSource(""), "require-heading")).toEqual([]);
  });
});

describe("max-size", () => {
  it("warns when the file exceeds the byte limit", () => {
    const source = "é";
    const findings = forRule(lintSource(source, { maxBytes: 1, maxTokens: 100 }), "max-size");
    expect(findings.map((finding) => finding.message)).toEqual([
      "File is 2 bytes, over the 1-byte limit; some agents (e.g. Codex, 32 KiB by default) truncate project docs beyond this.",
    ]);
    expect(findings[0]?.severity).toBe("warn");
  });

  it("warns when the rough token estimate exceeds the budget", () => {
    const source = "abcdefghij";
    const findings = forRule(lintSource(source, { maxBytes: 10_000, maxTokens: 2 }), "max-size");
    expect(findings.map((finding) => finding.message)).toEqual([
      "File is roughly 3 tokens (chars/4), over the 2-token budget; large instruction files crowd out the agent's context.",
    ]);
  });

  it("reports both limits when both are exceeded", () => {
    const findings = forRule(lintSource("hello", { maxBytes: 1, maxTokens: 1 }), "max-size");
    expect(findings).toHaveLength(2);
    expect(findings[0]?.message).toContain("bytes");
    expect(findings[1]?.message).toContain("tokens");
  });

  it("accepts a file within both limits", () => {
    expect(forRule(lintSource(doc), "max-size")).toEqual([]);
  });

  it("counts CJK and fullwidth characters as one token and other text as chars/4", () => {
    expect(analyzeSize("abcd").tokens).toBe(1);
    expect(analyzeSize("abcde").tokens).toBe(2);
    expect(analyzeSize("你").tokens).toBe(1);
    expect(analyzeSize("あ").tokens).toBe(1);
    expect(analyzeSize("ア").tokens).toBe(1);
    expect(analyzeSize("한").tokens).toBe(1);
    expect(analyzeSize("Ａ").tokens).toBe(1);
    expect(analyzeSize("あア한你Ａ").tokens).toBe(5);
    expect(analyzeSize("abcdあ").tokens).toBe(2);
    expect(analyzeSize("あ   ").tokens).toBe(2);
    expect(analyzeSize("").tokens).toBe(0);

    const source = "abcd你好";
    const findings = forRule(lintSource(source, { maxBytes: 10_000, maxTokens: 2 }), "max-size");
    expect(findings.map((finding) => finding.message)).toEqual([
      "File is roughly 3 tokens (CJK and fullwidth as 1 token, other text as chars/4), over the 2-token budget; large instruction files crowd out the agent's context.",
    ]);
  });

  it("mentions UTF-8 byte width when substantial CJK content exceeds maxBytes", () => {
    const over = "你abc";
    expect(analyzeSize(over).substantialCjk).toBe(true);
    const findings = forRule(lintSource(over, { maxBytes: 1, maxTokens: 100 }), "max-size");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("File is 6 bytes, over the 1-byte limit");
    expect(findings[0]?.message).toContain("CJK text uses 3 bytes per character in UTF-8, so it reaches the 32 KiB cap with ~11k characters.");
  });

  it("does not mention the CJK byte note at or below 20% of non-whitespace characters", () => {
    const exact = "你abcd";
    expect(analyzeSize(exact).substantialCjk).toBe(false);
    expect(analyzeSize(exact).cjkChars / analyzeSize(exact).nonWhitespaceChars).toBe(0.2);
    const findings = forRule(lintSource(exact, { maxBytes: 1, maxTokens: 100 }), "max-size");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).not.toContain("3 bytes per character");
    expect(findings[0]?.message).toContain("bytes, over the 1-byte limit");
  });
});

describe("no-empty-section", () => {
  it("flags a heading with no body before the next same-level heading", () => {
    const source = "# Empty\n\n# Filled\n\nSome text.\n";
    const findings = forRule(lintSource(source), "no-empty-section");
    expect(findings).toEqual([
      { ruleId: "no-empty-section", severity: "warn", message: 'Section "Empty" is empty.', line: 1, column: 1 },
    ]);
  });

  it("flags a leaf heading whose only body is a comment", () => {
    const source = "# Parent\n\n## Child\n\n<!-- nothing -->\n";
    const findings = forRule(lintSource(source), "no-empty-section");
    expect(findings.map((finding) => finding.message)).toEqual(['Section "Child" is empty.']);
  });

  it("treats a child heading as content for its parent", () => {
    const source = "# Parent\n\n## Child\n\nDetails.\n";
    expect(forRule(lintSource(source), "no-empty-section")).toEqual([]);
  });

  it("accepts sections that contain prose", () => {
    expect(forRule(lintSource(doc), "no-empty-section")).toEqual([]);
  });
});

describe("no-duplicate-heading", () => {
  it("flags sibling headings that share text, ignoring case", () => {
    const source = "# Setup\n\nFirst.\n\n# setup\n\nSecond.\n";
    const findings = forRule(lintSource(source), "no-duplicate-heading");
    expect(findings).toEqual([
      {
        ruleId: "no-duplicate-heading",
        severity: "warn",
        message: 'Duplicate heading "setup" (first defined on line 1); merge the sections to avoid conflicting instructions.',
        line: 5,
        column: 1,
      },
    ]);
  });

  it("allows the same heading text under different parents", () => {
    const source = "# A\n\n## Notes\n\nOne.\n\n# C\n\n## Notes\n\nTwo.\n";
    expect(forRule(lintSource(source), "no-duplicate-heading")).toEqual([]);
  });

  it("flags duplicate children of the same parent", () => {
    const source = "# A\n\n## Notes\n\nOne.\n\n## Notes\n\nTwo.\n";
    expect(forRule(lintSource(source), "no-duplicate-heading")).toHaveLength(1);
  });
});

describe("no-placeholder", () => {
  it.each(["TODO", "TBD", "FIXME", "lorem ipsum", "<insert name>", "<your-token>"])("flags %s", (token) => {
    const source = `# Work\n\nPlease ${token} before shipping.\n`;
    const findings = forRule(lintSource(source), "no-placeholder");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "warn",
      line: 3,
      message: `Placeholder text "${token}" found; agents may follow it literally.`,
    });
  });

  it("reports the column of the match", () => {
    const findings = forRule(lintSource("# Work\n\n  TODO later\n"), "no-placeholder");
    expect(findings[0]?.column).toBe(3);
  });

  it("ignores placeholders inside fenced code", () => {
    const source = "# Work\n\n```\nTODO\n```\n\nReal instructions.\n";
    expect(forRule(lintSource(source), "no-placeholder")).toEqual([]);
  });

  it("does not flag words that merely contain a marker", () => {
    const source = "# Work\n\nShip today. The TODOS list is a product name.\n";
    expect(forRule(lintSource(source), "no-placeholder")).toEqual([]);
  });
});
