import { describe, expect, it } from "vitest";
import { parseMarkdown, slugify } from "../src/markdown.js";

describe("slugify", () => {
  it("lowercases, strips punctuation, and turns spaces into dashes", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
  });

  it("trims and drops HTML tags", () => {
    expect(slugify("  <em>Café</em>  ")).toBe("café");
  });

  it("keeps letters, numbers, underscores, and existing dashes", () => {
    expect(slugify("API_v2 — draft")).toBe("api_v2--draft");
  });

  it("removes characters that are not letters, numbers, spaces, or dashes", () => {
    expect(slugify("A & B")).toBe("a--b");
  });
});

describe("parseMarkdown headings", () => {
  it("reads ATX headings, levels, stripped text, and closing hashes", () => {
    const doc = parseMarkdown("# Title\n##  Hello World  ##\n   ### Third\n");
    expect(doc.headings.map((heading) => [heading.level, heading.text, heading.slug, heading.line])).toEqual([
      [1, "Title", "title", 1],
      [2, "Hello World", "hello-world", 2],
      [3, "Third", "third", 3],
    ]);
  });

  it("strips inline code and links out of heading text", () => {
    const doc = parseMarkdown("## Run `npm test`\n## See [the docs](./docs.md)\n");
    expect(doc.headings.map((heading) => heading.text)).toEqual(["Run npm test", "See the docs"]);
    expect(doc.headings.map((heading) => heading.slug)).toEqual(["run-npm-test", "see-the-docs"]);
  });

  it("ignores a heading indented four spaces", () => {
    const doc = parseMarkdown("    ## Not a heading\n");
    expect(doc.headings).toEqual([]);
  });

  it("ignores headings inside fenced code", () => {
    const doc = parseMarkdown("# Real\n\n```\n# Fake\n## Also fake\n```\n\n## Also real\n");
    expect(doc.headings.map((heading) => heading.text)).toEqual(["Real", "Also real"]);
  });

  it("suffixes duplicate slugs", () => {
    const doc = parseMarkdown("# Setup\n# Setup\n# Setup!\n");
    expect(doc.headings.map((heading) => heading.slug)).toEqual(["setup", "setup-1", "setup-2"]);
  });

  it("strips a leading BOM before parsing", () => {
    const doc = parseMarkdown("\uFEFF# Title\n");
    expect(doc.headings).toHaveLength(1);
    expect(doc.headings[0]?.text).toBe("Title");
    expect(doc.source.startsWith("\uFEFF")).toBe(false);
  });
});

describe("parseMarkdown links", () => {
  it("captures inline links, angle targets, and titles", () => {
    const line = 'See [docs](./docs/guide.md) and [a](<b.md>) plus [t](c.md "title")';
    const doc = parseMarkdown(line);
    expect(doc.links.map((link) => [link.text, link.target, link.column])).toEqual([
      ["docs", "./docs/guide.md", line.indexOf("[docs]") + 1],
      ["a", "b.md", line.indexOf("[a]") + 1],
      ["t", "c.md", line.indexOf("[t]") + 1],
    ]);
  });

  it("captures images as links, including the leading bang in the column", () => {
    const doc = parseMarkdown("![pic](pic.png)\n");
    expect(doc.links).toEqual([{ text: "pic", target: "pic.png", line: 1, column: 1 }]);
  });

  it("captures reference definitions and points the column at the target", () => {
    const line = "[name]: https://example.com/x";
    const doc = parseMarkdown(`${line}\n[other]: <https://example.com/y>\n`);
    expect(doc.links.map((link) => [link.text, link.target, link.line])).toEqual([
      ["name", "https://example.com/x", 1],
      ["other", "https://example.com/y", 2],
    ]);
    expect(doc.links[0]?.column).toBe(line.indexOf("https://example.com/x") + 1);
  });

  it("ignores links inside code spans", () => {
    const doc = parseMarkdown("See `[text](url)` and `![alt](pic.png)` now.\n");
    expect(doc.links).toEqual([]);
    expect(doc.codeSpans.map((span) => span.value)).toEqual(["[text](url)", "![alt](pic.png)"]);
  });

  it("ignores links inside fenced code", () => {
    const doc = parseMarkdown("```md\n[hidden](secret.md)\n```\n[shown](visible.md)\n");
    expect(doc.links.map((link) => link.target)).toEqual(["visible.md"]);
  });

  it("still records a link that sits on a heading line", () => {
    const doc = parseMarkdown("## [Docs](./docs.md)\n");
    expect(doc.headings[0]?.text).toBe("Docs");
    expect(doc.links.map((link) => link.target)).toEqual(["./docs.md"]);
  });
});

describe("parseMarkdown code", () => {
  it("records code spans with the column of the value", () => {
    const line = "use `npm test` here";
    const doc = parseMarkdown(line);
    expect(doc.codeSpans).toEqual([{ value: "npm test", line: 1, column: line.indexOf("npm test") + 1 }]);
  });

  it("records fenced blocks, their language, body, and covered lines", () => {
    const source = "```ts\nconst a = 1\nconst b = 2\n```\n";
    const doc = parseMarkdown(source);
    expect(doc.codeBlocks).toEqual([{ lang: "ts", body: "const a = 1\nconst b = 2", line: 2 }]);
    expect([...doc.codeBlockLines]).toEqual([1, 2, 3, 4]);
  });

  it("accepts tilde fences and keeps an unterminated fence", () => {
    const doc = parseMarkdown("~~~bash\necho hi");
    expect(doc.codeBlocks).toEqual([{ lang: "bash", body: "echo hi", line: 2 }]);
    expect([...doc.codeBlockLines]).toEqual([1, 2]);
  });

  it("does not close a fence with a shorter marker", () => {
    const doc = parseMarkdown("````markdown\n# hi\n```\nstill inside");
    expect(doc.codeBlocks).toHaveLength(1);
    expect(doc.codeBlocks[0]?.body).toBe("# hi\n```\nstill inside");
    expect(doc.headings).toEqual([]);
  });

  it("splits lines on CRLF", () => {
    const doc = parseMarkdown("# One\r\n\r\n```\r\ncode\r\n```\r\n");
    expect(doc.lines).toEqual(["# One", "", "```", "code", "```", ""]);
    expect(doc.headings.map((heading) => heading.text)).toEqual(["One"]);
    expect(doc.codeBlocks[0]?.body).toBe("code");
  });
});
