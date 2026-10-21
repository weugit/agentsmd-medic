import { readFile } from "node:fs/promises";
import path from "node:path";
import { toPosix } from "./discover.js";
import type { Config, RuleSetting } from "./types.js";

export const CONFIG_FILE_NAMES = [".agentsmd-doctor.json", "agentsmd-doctor.config.json"];

export const DEFAULT_CONFIG: Config = {
  rules: {},
  ignore: [],
  maxBytes: 32 * 1024,
  maxTokens: 8000,
};

const SETTINGS: RuleSetting[] = ["error", "warn", "off"];

export class ConfigError extends Error {}

export function validateConfig(raw: unknown, source: string): Partial<Config> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`${source}: config must be a JSON object`);
  }
  const obj = raw as Record<string, unknown>;
  const out: Partial<Config> = {};
  if (obj.rules !== undefined) {
    if (typeof obj.rules !== "object" || obj.rules === null || Array.isArray(obj.rules)) throw new ConfigError(`${source}: "rules" must be an object`);
    out.rules = {};
    for (const [k, v] of Object.entries(obj.rules)) {
      if (!SETTINGS.includes(v as RuleSetting)) throw new ConfigError(`${source}: rule "${k}" must be one of ${SETTINGS.join(", ")}`);
      out.rules[k] = v as RuleSetting;
    }
  }
  if (obj.ignore !== undefined) {
    if (!Array.isArray(obj.ignore) || !obj.ignore.every((x) => typeof x === "string")) throw new ConfigError(`${source}: "ignore" must be an array of strings`);
    out.ignore = obj.ignore;
  }
  for (const key of ["maxBytes", "maxTokens"] as const) {
    if (obj[key] !== undefined) {
      if (typeof obj[key] !== "number" || !(obj[key] > 0)) throw new ConfigError(`${source}: "${key}" must be a positive number`);
      out[key] = obj[key];
    }
  }
  return out;
}

/** Load config from an explicit path, or look for a default config file in `root`. */
export async function loadConfig(root: string, explicitPath?: string): Promise<{ config: Config; path?: string }> {
  const candidates = explicitPath ? [path.resolve(explicitPath)] : CONFIG_FILE_NAMES.map((n) => path.join(root, n));
  for (const candidate of candidates) {
    const shown = toPosix(candidate);
    let text: string;
    try {
      text = await readFile(candidate, "utf8");
    } catch (err) {
      if (explicitPath) throw new ConfigError(`Cannot read config file ${shown}: ${toPosix((err as Error).message)}`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new ConfigError(`${shown}: invalid JSON (${(err as Error).message})`);
    }
    return { config: mergeConfig(DEFAULT_CONFIG, validateConfig(parsed, shown)), path: candidate };
  }
  return { config: { ...DEFAULT_CONFIG, rules: {} } };
}

export function mergeConfig(base: Config, override: Partial<Config>): Config {
  return {
    rules: { ...base.rules, ...override.rules },
    ignore: [...base.ignore, ...(override.ignore ?? [])],
    maxBytes: override.maxBytes ?? base.maxBytes,
    maxTokens: override.maxTokens ?? base.maxTokens,
  };
}
