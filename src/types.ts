export type Severity = "error" | "warn";
export type RuleSetting = Severity | "off";

export interface Diagnostic {
  ruleId: string;
  severity: Severity;
  message: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
}

export interface Heading {
  level: number;
  text: string;
  line: number;
  slug: string;
}

export interface Link {
  text: string;
  target: string;
  line: number;
  column: number;
}

export interface CodeSpan {
  value: string;
  line: number;
  column: number;
}

export interface ParsedDoc {
  source: string;
  lines: string[];
  headings: Heading[];
  links: Link[];
  codeSpans: CodeSpan[];
  /** Lines (1-based) inside fenced code blocks. */
  codeBlockLines: Set<number>;
  /** Contents of fenced code blocks with the starting line of their body. */
  codeBlocks: { lang: string; body: string; line: number }[];
}

export interface Config {
  rules: Record<string, RuleSetting>;
  /** Directory names or path prefixes (relative to the root) to skip during discovery. */
  ignore: string[];
  /** Soft size limit in bytes. Codex reads at most 32 KiB of project docs by default. */
  maxBytes: number;
  /** Soft limit for the rough token estimate (CJK and fullwidth ≈ 1 token, other text ≈ chars / 4). */
  maxTokens: number;
}

export interface RuleContext {
  /** Absolute path of the file being linted. */
  file: string;
  /** Absolute path of the lint root (usually the repo root). */
  root: string;
  doc: ParsedDoc;
  config: Config;
}

export interface Rule {
  id: string;
  description: string;
  defaultSeverity: Severity;
  check(ctx: RuleContext): Omit<Diagnostic, "ruleId" | "severity">[];
}

export interface FileResult {
  file: string;
  /** Path relative to the lint root, using forward slashes. */
  relativePath: string;
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
}

export interface LintResult {
  root: string;
  files: FileResult[];
  errorCount: number;
  warningCount: number;
}
