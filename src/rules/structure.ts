import type { Rule } from "../types.js";

export const noEmptyFile: Rule = {
  id: "no-empty-file",
  description: "The file must contain some instructions.",
  defaultSeverity: "error",
  check({ doc }) {
    const meaningful = doc.source.replace(/<!--[\s\S]*?-->/g, "").trim();
    return meaningful ? [] : [{ message: "File is empty; agents will get no instructions from it.", line: 1, column: 1 }];
  },
};

export const requireHeading: Rule = {
  id: "require-heading",
  description: "Use at least one Markdown heading so agents (and humans) can navigate sections.",
  defaultSeverity: "warn",
  check({ doc }) {
    if (!doc.source.trim() || doc.headings.length > 0) return [];
    return [{ message: "No Markdown headings found; structure instructions into sections (e.g. `## Setup`, `## Testing`).", line: 1, column: 1 }];
  },
};

export const maxSize: Rule = {
  id: "max-size",
  description: "Keep the file within the size agents actually read.",
  defaultSeverity: "warn",
  check({ doc, config }) {
    const out = [];
    const bytes = Buffer.byteLength(doc.source, "utf8");
    if (bytes > config.maxBytes) {
      out.push({
        message: `File is ${bytes} bytes, over the ${config.maxBytes}-byte limit; some agents (e.g. Codex, 32 KiB by default) truncate project docs beyond this.`,
        line: 1,
        column: 1,
      });
    }
    const tokens = Math.ceil(doc.source.length / 4);
    if (tokens > config.maxTokens) {
      out.push({
        message: `File is roughly ${tokens} tokens (chars/4), over the ${config.maxTokens}-token budget; large instruction files crowd out the agent's context.`,
        line: 1,
        column: 1,
      });
    }
    return out;
  },
};

export const noEmptySection: Rule = {
  id: "no-empty-section",
  description: "Headings should be followed by content before the next heading of the same or higher level.",
  defaultSeverity: "warn",
  check({ doc }) {
    const out = [];
    const { headings, lines } = doc;
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i]!;
      let end = lines.length + 1;
      let hasChild = false;
      for (let j = i + 1; j < headings.length; j++) {
        const next = headings[j]!;
        if (next.level <= h.level) {
          end = next.line;
          break;
        }
        hasChild = true;
        end = next.line;
        break;
      }
      if (hasChild) continue;
      const body = lines.slice(h.line, end - 1).join("\n").replace(/<!--[\s\S]*?-->/g, "").trim();
      if (!body) out.push({ message: `Section "${h.text}" is empty.`, line: h.line, column: 1 });
    }
    return out;
  },
};

export const noDuplicateHeading: Rule = {
  id: "no-duplicate-heading",
  description: "Sibling sections should not share a heading; duplicated sections often carry conflicting instructions.",
  defaultSeverity: "warn",
  check({ doc }) {
    const out = [];
    const seen = new Map<string, number>();
    const stack: string[] = [];
    for (const h of doc.headings) {
      stack.length = h.level - 1;
      const parent = stack.slice(0, h.level - 1).join(" > ");
      const key = `${parent}|${h.level}|${h.text.toLowerCase()}`;
      const prev = seen.get(key);
      if (prev !== undefined) {
        out.push({ message: `Duplicate heading "${h.text}" (first defined on line ${prev}); merge the sections to avoid conflicting instructions.`, line: h.line, column: 1 });
      } else {
        seen.set(key, h.line);
      }
      stack[h.level - 1] = h.text.toLowerCase();
    }
    return out;
  },
};

const PLACEHOLDER = /\b(TODO|TBD|FIXME|lorem ipsum)\b|<(?:insert|your)[ -][^>]*>/i;

export const noPlaceholder: Rule = {
  id: "no-placeholder",
  description: "Flag unfinished placeholder text (TODO, TBD, lorem ipsum, <insert ...>).",
  defaultSeverity: "warn",
  check({ doc }) {
    const out = [];
    doc.lines.forEach((line, i) => {
      if (doc.codeBlockLines.has(i + 1)) return;
      const m = PLACEHOLDER.exec(line);
      if (m) out.push({ message: `Placeholder text "${m[0]}" found; agents may follow it literally.`, line: i + 1, column: m.index + 1 });
    });
    return out;
  },
};
