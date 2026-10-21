import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, CONFIG_FILE_NAMES, DEFAULT_CONFIG, loadConfig } from "../src/config.js";
import { toPosix } from "../src/discover.js";
import { tempDir, writeTree } from "./helpers.js";

describe("loadConfig", () => {
  it("returns defaults when no config file is present", async () => {
    const root = await tempDir();
    const loaded = await loadConfig(root);
    expect(loaded.path).toBeUndefined();
    expect(loaded.config).toEqual({
      rules: {},
      ignore: [],
      maxBytes: 32 * 1024,
      maxTokens: 8000,
    });
    expect(loaded.config.maxBytes).toBe(DEFAULT_CONFIG.maxBytes);
    expect(CONFIG_FILE_NAMES).toEqual([".agentsmd-lint.json", "agentsmd-lint.config.json"]);
  });

  it("loads .agentsmd-lint.json and keeps unspecified defaults", async () => {
    const root = await tempDir();
    await writeTree(root, {
      ".agentsmd-lint.json": JSON.stringify({
        rules: { "no-placeholder": "error" },
        ignore: ["legacy"],
        maxBytes: 100,
      }),
    });
    const loaded = await loadConfig(root);
    expect(loaded.path).toBe(path.join(root, ".agentsmd-lint.json"));
    expect(loaded.config.rules).toEqual({ "no-placeholder": "error" });
    expect(loaded.config.ignore).toEqual(["legacy"]);
    expect(loaded.config.maxBytes).toBe(100);
    expect(loaded.config.maxTokens).toBe(8000);
  });

  it("falls through to agentsmd-lint.config.json", async () => {
    const root = await tempDir();
    await writeTree(root, {
      "agentsmd-lint.config.json": JSON.stringify({ maxTokens: 50 }),
    });
    const loaded = await loadConfig(root);
    expect(loaded.path).toBe(path.join(root, "agentsmd-lint.config.json"));
    expect(loaded.config.maxTokens).toBe(50);
    expect(loaded.config.maxBytes).toBe(DEFAULT_CONFIG.maxBytes);
  });

  it("prefers .agentsmd-lint.json when both names exist", async () => {
    const root = await tempDir();
    await writeTree(root, {
      ".agentsmd-lint.json": JSON.stringify({ maxBytes: 10 }),
      "agentsmd-lint.config.json": JSON.stringify({ maxBytes: 20 }),
    });
    const loaded = await loadConfig(root);
    expect(loaded.config.maxBytes).toBe(10);
  });

  it("loads an explicit path and does not fall back to a default file", async () => {
    const root = await tempDir();
    await writeTree(root, {
      ".agentsmd-lint.json": JSON.stringify({ maxBytes: 10 }),
      "custom.json": JSON.stringify({ maxBytes: 42, ignore: ["skip"] }),
    });
    const loaded = await loadConfig(root, path.join(root, "custom.json"));
    expect(loaded.path).toBe(path.join(root, "custom.json"));
    expect(loaded.config.maxBytes).toBe(42);
    expect(loaded.config.ignore).toEqual(["skip"]);
  });

  it("throws ConfigError for invalid JSON", async () => {
    const root = await tempDir();
    const file = path.join(root, ".agentsmd-lint.json");
    await writeTree(root, { ".agentsmd-lint.json": "{ not json" });
    await expect(loadConfig(root)).rejects.toThrow(ConfigError);
    await expect(loadConfig(root)).rejects.toThrow(/invalid JSON/);
    await expect(loadConfig(root, file)).rejects.toThrow(toPosix(file));
  });

  it("throws ConfigError for an invalid rule setting", async () => {
    const root = await tempDir();
    await writeTree(root, {
      ".agentsmd-lint.json": JSON.stringify({ rules: { "no-secrets": "fatal" } }),
    });
    await expect(loadConfig(root)).rejects.toThrow(ConfigError);
    await expect(loadConfig(root)).rejects.toThrow(/rule "no-secrets" must be one of error, warn, off/);
  });

  it("throws ConfigError when maxBytes is not a positive number", async () => {
    const root = await tempDir();
    await writeTree(root, { ".agentsmd-lint.json": JSON.stringify({ maxBytes: 0 }) });
    await expect(loadConfig(root)).rejects.toThrow(ConfigError);
    await expect(loadConfig(root)).rejects.toThrow(/"maxBytes" must be a positive number/);

    await writeTree(root, { ".agentsmd-lint.json": JSON.stringify({ maxBytes: -5 }) });
    await expect(loadConfig(root)).rejects.toThrow(/"maxBytes"/);

    await writeTree(root, { ".agentsmd-lint.json": JSON.stringify({ maxBytes: "32768" }) });
    await expect(loadConfig(root)).rejects.toThrow(/"maxBytes"/);
  });

  it("throws ConfigError when the explicit file is missing", async () => {
    const root = await tempDir();
    const missing = path.join(root, "missing.json");
    await expect(loadConfig(root, missing)).rejects.toThrow(ConfigError);
    await expect(loadConfig(root, missing)).rejects.toThrow(new RegExp(`Cannot read config file ${toPosix(missing).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });

  it("throws ConfigError when the document is not an object", async () => {
    const root = await tempDir();
    await writeTree(root, { ".agentsmd-lint.json": "[1, 2, 3]" });
    await expect(loadConfig(root)).rejects.toThrow(/config must be a JSON object/);
  });

  it("throws ConfigError when ignore or rules have the wrong shape", async () => {
    const root = await tempDir();
    await writeTree(root, { ".agentsmd-lint.json": JSON.stringify({ ignore: "dist" }) });
    await expect(loadConfig(root)).rejects.toThrow(/"ignore" must be an array of strings/);

    await writeTree(root, { ".agentsmd-lint.json": JSON.stringify({ rules: ["no-secrets"] }) });
    await expect(loadConfig(root)).rejects.toThrow(/"rules" must be an object/);
  });

  it("throws ConfigError when maxTokens is not positive", async () => {
    const root = await tempDir();
    await writeTree(root, { ".agentsmd-lint.json": JSON.stringify({ maxTokens: 0 }) });
    await expect(loadConfig(root)).rejects.toThrow(/"maxTokens" must be a positive number/);
  });
});
