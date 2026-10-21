import path from "node:path";
import { readFileSync } from "node:fs";
import { parseMarkdown } from "../markdown.js";
import type { Rule } from "../types.js";
import { pathExists } from "./util.js";

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function anchorsOf(file: string): Set<string> | undefined {
  if (!/\.(md|markdown|mdx)$/i.test(file)) return undefined;
  try {
    return new Set(parseMarkdown(readFileSync(file, "utf8")).headings.map((h) => h.slug));
  } catch {
    return undefined;
  }
}

export const noBrokenLinks: Rule = {
  id: "no-broken-links",
  description: "Relative links and in-page anchors must resolve.",
  defaultSeverity: "error",
  check({ doc, file, root }) {
    const out = [];
    const ownAnchors = new Set(doc.headings.map((h) => h.slug));
    for (const link of doc.links) {
      const target = link.target.trim();
      if (!target || EXTERNAL.test(target)) continue;
      const [rawPath, anchor] = target.split("#", 2) as [string, string | undefined];
      let decoded: string;
      try {
        decoded = decodeURIComponent(rawPath.split("?")[0]!);
      } catch {
        decoded = rawPath;
      }
      if (!decoded) {
        if (anchor && !ownAnchors.has(anchor.toLowerCase())) {
          out.push({ message: `Anchor "#${anchor}" does not match any heading in this file.`, line: link.line, column: link.column });
        }
        continue;
      }
      const resolved = decoded.startsWith("/") ? path.join(root, decoded) : path.resolve(path.dirname(file), decoded);
      if (!pathExists(resolved)) {
        const shown = path.relative(root, resolved) || ".";
        const where = shown === target ? "" : ` (resolved to ${shown})`;
        out.push({ message: `Broken link: "${target}"${where} does not exist.`, line: link.line, column: link.column });
        continue;
      }
      if (anchor) {
        const anchors = anchorsOf(resolved);
        if (anchors && !anchors.has(anchor.toLowerCase())) {
          out.push({ message: `Anchor "#${anchor}" not found in ${path.relative(root, resolved)}.`, line: link.line, column: link.column });
        }
      }
    }
    return out;
  },
};
