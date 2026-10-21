import type { CodeSpan, Heading, Link, ParsedDoc } from "./types.js";

/** GitHub-style heading slug: lowercase, strip punctuation, spaces to dashes. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function stripInline(text: string): string {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~]/g, "")
    .trim();
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)/;
const ATX = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const LINK = /!?\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const REF_DEF = /^ {0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+.*)?$/;
const CODE_SPAN = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;

/**
 * A deliberately small Markdown scanner. It understands exactly what the
 * rules need (ATX headings, fenced code, inline links, reference
 * definitions, and code spans) and nothing more, so it has no dependencies.
 */
export function parseMarkdown(source: string): ParsedDoc {
  const text = source.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const headings: Heading[] = [];
  const links: Link[] = [];
  const codeSpans: CodeSpan[] = [];
  const codeBlockLines = new Set<number>();
  const codeBlocks: ParsedDoc["codeBlocks"] = [];
  const slugCounts = new Map<string, number>();

  let fence: { marker: string; lang: string; start: number; body: string[] } | null = null;

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const fenceMatch = FENCE.exec(raw);
    if (fence) {
      codeBlockLines.add(lineNo);
      if (fenceMatch && fenceMatch[1]![0] === fence.marker[0] && fenceMatch[1]!.length >= fence.marker.length && !fenceMatch[2]) {
        codeBlocks.push({ lang: fence.lang, body: fence.body.join("\n"), line: fence.start + 1 });
        fence = null;
      } else {
        fence.body.push(raw);
      }
      return;
    }
    if (fenceMatch) {
      codeBlockLines.add(lineNo);
      fence = { marker: fenceMatch[1]!, lang: fenceMatch[2] ?? "", start: lineNo, body: [] };
      return;
    }

    const h = ATX.exec(raw);
    if (h) {
      const headingText = stripInline(h[2] ?? "");
      const base = slugify(headingText);
      const n = slugCounts.get(base) ?? 0;
      slugCounts.set(base, n + 1);
      headings.push({ level: h[1]!.length, text: headingText, line: lineNo, slug: n === 0 ? base : `${base}-${n}` });
    }

    const ref = REF_DEF.exec(raw);
    if (ref) {
      links.push({ text: ref[1]!, target: ref[2]!, line: lineNo, column: raw.indexOf(ref[2]!) + 1 });
    }

    // Code spans first, so links inside backticks are not treated as links.
    const spanRanges: [number, number][] = [];
    for (const m of raw.matchAll(CODE_SPAN)) {
      const value = m[2]!.trim();
      spanRanges.push([m.index, m.index + m[0].length]);
      codeSpans.push({ value, line: lineNo, column: m.index + m[1]!.length + 1 });
    }
    const inSpan = (idx: number) => spanRanges.some(([s, e]) => idx >= s && idx < e);

    for (const m of raw.matchAll(LINK)) {
      if (inSpan(m.index)) continue;
      links.push({ text: m[1]!, target: m[2]!, line: lineNo, column: m.index + 1 });
    }
  });

  if (fence) {
    const open = fence as { lang: string; start: number; body: string[] };
    codeBlocks.push({ lang: open.lang, body: open.body.join("\n"), line: open.start + 1 });
  }

  return { source: text, lines, headings, links, codeSpans, codeBlockLines, codeBlocks };
}
