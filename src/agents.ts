/**
 * Documented instruction-file behavior for coding agents.
 *
 * These behaviors change as agents ship updates. Treat this module as a snapshot
 * of the public docs, not a guarantee of what a future release reads. Check the
 * linked page when a doctor report looks wrong. Doctor does not read home-directory
 * files (`~/.codex`, `~/.claude`, `~/.gemini`, and similar).
 *
 * - OpenAI Codex: https://developers.openai.com/codex/guides/agents-md
 * - Claude Code: https://code.claude.com/docs/en/memory
 * - Cursor: https://cursor.com/docs/rules
 * - GitHub Copilot: https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot
 * - Gemini CLI: https://geminicli.com/docs/cli/gemini-md
 */

/** Default `project_doc_max_bytes`. Codex stops adding project docs at this size. */
export const CODEX_PROJECT_DOC_MAX_BYTES = 32 * 1024;

/** Printed when AGENTS.md is present and no CLAUDE.md imports it. */
export const CLAUDE_AGENTS_IGNORED = "AGENTS.md is ignored by Claude Code: no CLAUDE.md imports it";

/** Printed when CLAUDE.local.md is on the path from the repo root to the directory. */
export const CLAUDE_LOCAL_WARNING = "CLAUDE.local.md exists (personal, git-ignored, may override shared instructions).";

/** Printed when a legacy .cursorrules file is present. */
export const CURSOR_LEGACY_WARNING = "Legacy .cursorrules is deprecated. Cursor recommends .cursor/rules/*.mdc instead.";

/**
 * Printed when the directory has AGENTS.md and Gemini would not load it.
 * Gemini reads GEMINI.md unless `context.fileName` says otherwise.
 */
export const GEMINI_ONLY_AGENTS_WARNING =
  "Gemini CLI reads GEMINI.md by default and loads AGENTS.md only when context.fileName includes it. Only AGENTS.md exists here.";

export interface AgentInfo {
  id: "codex" | "claude" | "cursor" | "copilot" | "gemini";
  name: string;
  docsUrl: string;
  /** What doctor checks, in one sentence. */
  loads: string;
}

export const AGENTS: readonly AgentInfo[] = [
  {
    id: "codex",
    name: "OpenAI Codex",
    docsUrl: "https://developers.openai.com/codex/guides/agents-md",
    loads:
      "From the git root down to the directory, AGENTS.override.md if that directory has one, otherwise AGENTS.md. Files are concatenated from the root toward the leaf and capped by project_doc_max_bytes (32 KiB by default).",
  },
  {
    id: "claude",
    name: "Claude Code",
    docsUrl: "https://code.claude.com/docs/en/memory",
    loads:
      "CLAUDE.md and CLAUDE.local.md on the path from the git root to the directory. AGENTS.md is included only when a CLAUDE.md line imports it (@AGENTS.md, @./AGENTS.md, or another relative path to AGENTS.md).",
  },
  {
    id: "cursor",
    name: "Cursor",
    docsUrl: "https://cursor.com/docs/rules",
    loads: "AGENTS.md at the repo root and in nested directories, .cursor/rules/*.mdc files, and legacy .cursorrules (deprecated).",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    docsUrl: "https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot",
    loads: ".github/copilot-instructions.md, .github/instructions/*.instructions.md, and AGENTS.md.",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    docsUrl: "https://geminicli.com/docs/cli/gemini-md",
    loads: "GEMINI.md by default. AGENTS.md only when settings set context.fileName to include it.",
  },
];

const AGENT_BY_ID = new Map(AGENTS.map((agent) => [agent.id, agent]));

export function agentInfo(id: AgentInfo["id"]): AgentInfo {
  const info = AGENT_BY_ID.get(id);
  if (!info) throw new Error(`Unknown agent: ${id}`);
  return info;
}
