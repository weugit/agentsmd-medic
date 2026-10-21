import path from "node:path";
import type { Rule } from "../types.js";
import { extractCommands, pathExists } from "./util.js";

const MANAGERS = new Map<string, string>([
  ["npm", "npm"],
  ["npx", "npm"],
  ["pnpm", "pnpm"],
  ["pnpx", "pnpm"],
  ["yarn", "yarn"],
  ["bun", "bun"],
  ["bunx", "bun"],
]);

const LOCKFILES: { file: string; manager: string }[] = [
  { file: "package-lock.json", manager: "npm" },
  { file: "npm-shrinkwrap.json", manager: "npm" },
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "bun.lockb", manager: "bun" },
  { file: "bun.lock", manager: "bun" },
];

function unquote(token: string): string {
  if (token.length >= 2) {
    const q = token[0];
    if ((q === '"' || q === "'") && token.endsWith(q)) return token.slice(1, -1);
  }
  return token;
}

/** Lockfiles at the root when they all belong to one manager other than `used`. */
function otherLockfiles(root: string, used: string): string | undefined {
  const present = LOCKFILES.filter((lock) => pathExists(path.join(root, lock.file)));
  const managers = new Set(present.map((lock) => lock.manager));
  if (present.length === 0 || managers.size !== 1 || managers.has(used)) return undefined;
  return present.map((lock) => lock.file).join(" and ");
}

export const consistentPackageManager: Rule = {
  id: "consistent-package-manager",
  description: "Commands should use one package manager, the one the repository locks.",
  defaultSeverity: "warn",
  check({ doc, root }) {
    const out = [];
    let first: { name: string; line: number; column: number } | undefined;
    for (const cmd of extractCommands(doc)) {
      const token = cmd.command.split(/\s+/)[0];
      if (!token) continue;
      const name = MANAGERS.get(unquote(token));
      if (!name) continue;
      if (!first) {
        first = { name, line: cmd.line, column: cmd.column };
        continue;
      }
      if (name !== first.name) {
        out.push({
          message: `Instructions mix ${first.name} and ${name}; agents may run the wrong one.`,
          line: cmd.line,
          column: cmd.column,
        });
        return out;
      }
    }
    if (first) {
      const locks = otherLockfiles(root, first.name);
      if (locks) {
        out.push({
          message: `Instructions use ${first.name} but the repo has ${locks}.`,
          line: first.line,
          column: first.column,
        });
      }
    }
    return out;
  },
};
