import type { Rule } from "../types.js";
import { noBrokenLinks } from "./links.js";
import { consistentPackageManager } from "./package-managers.js";
import { noMissingPaths } from "./paths.js";
import { noMissingScripts } from "./scripts.js";
import { noSecrets } from "./secrets.js";
import { maxSize, noDuplicateHeading, noEmptyFile, noEmptySection, noPlaceholder, requireHeading } from "./structure.js";

export const rules: Rule[] = [
  noEmptyFile,
  requireHeading,
  maxSize,
  noEmptySection,
  noDuplicateHeading,
  noPlaceholder,
  noBrokenLinks,
  noMissingPaths,
  noMissingScripts,
  noSecrets,
  consistentPackageManager,
];

export const ruleMap = new Map<string, Rule>(rules.map((rule) => [rule.id, rule]));
