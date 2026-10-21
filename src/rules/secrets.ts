import type { Diagnostic, Rule } from "../types.js";

type Finding = Omit<Diagnostic, "ruleId" | "severity">;

interface Detector {
  kind: string;
  re: RegExp;
  /** Capture group holding the secret. Defaults to the whole match. */
  valueGroup?: number;
  kindFrom?: (match: RegExpMatchArray) => string;
}

const PLACEHOLDER_WORDS = ["your", "example", "changeme", "dummy", "redacted", "placeholder", "fake"];

const DETECTORS: Detector[] = [
  { kind: "AWS access key", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { kind: "GitHub token", re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { kind: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "OpenAI API key", re: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { kind: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "Stripe API key", re: /\b[sr]k_live_[A-Za-z0-9]{16,}/g },
  { kind: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { kind: "JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    kind: "secret",
    re: /(password|passwd|secret|token|api[_-]?key|access[_-]?key)\s*[:=]\s*["']?([^\s"']{12,})/gi,
    valueGroup: 2,
    kindFrom: (match) => genericKind(match[1] ?? "secret"),
  },
];

function genericKind(word: string): string {
  switch (word.toLowerCase().replace(/[_-]/g, "")) {
    case "password":
    case "passwd":
      return "password";
    case "secret":
      return "secret";
    case "token":
      return "token";
    case "apikey":
      return "API key";
    case "accesskey":
      return "access key";
    default:
      return word.toLowerCase();
  }
}

function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  if (lower.includes("xxxx")) return true;
  if (value.includes("<") || value.includes(">") || value.includes("${") || value.includes("{{")) return true;
  if (PLACEHOLDER_WORDS.some((word) => lower.includes(word))) return true;
  return /^(.)\1+$/.test(value);
}

function message(kind: string, value: string): string {
  return `Possible ${kind} found ("${value.slice(0, 4)}…"); remove it and rotate the credential.`;
}

export const noSecrets: Rule = {
  id: "no-secrets",
  description: "Instruction files must not embed credentials or secret tokens.",
  defaultSeverity: "error",
  check({ doc }) {
    const out: Finding[] = [];
    doc.lines.forEach((line, i) => {
      for (const detector of DETECTORS) {
        detector.re.lastIndex = 0;
        for (const match of line.matchAll(detector.re)) {
          const group = detector.valueGroup ?? 0;
          const value = match[group];
          if (!value || isPlaceholder(value)) continue;
          out.push({
            message: message(detector.kindFrom?.(match) ?? detector.kind, value),
            line: i + 1,
            column: (match.index ?? 0) + 1,
          });
        }
      }
    });
    return out;
  },
};
