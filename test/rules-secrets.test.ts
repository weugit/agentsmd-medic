import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/types.js";
import { forRule, lintSource } from "./helpers.js";

const MIXED = "abcd".repeat(12);

function secretFindings(source: string): Diagnostic[] {
  return forRule(lintSource(`# Setup\n\n${source}\n`), "no-secrets");
}

function expectSecret(source: string, secret: string, kind: string): Diagnostic[] {
  const wrapped = `# Setup\n\n${source}\n`;
  const all = lintSource(wrapped);
  for (const finding of all) {
    expect(finding.message).not.toContain(secret);
    expect(finding.message).not.toContain(secret.slice(4));
  }
  const findings = forRule(all, "no-secrets");
  expect(findings).toHaveLength(1);
  const finding = findings[0];
  expect(finding?.severity).toBe("error");
  expect(finding?.message).toContain(kind);
  expect(finding?.message).toContain(`"${secret.slice(0, 4)}…"`);
  return findings;
}

describe("no-secrets", () => {
  it("flags an AWS access key", () => {
    const secret = "AKIAABCDEFGH12345678";
    expectSecret(`aws ${secret}`, secret, "AWS access key");
  });

  it("flags GitHub tokens, including a fine-grained pat", () => {
    const classic = `ghp_${"a".repeat(36)}`;
    expectSecret(`token ${classic}`, classic, "GitHub token");
    const pat = `github_pat_${"b".repeat(22)}`;
    expectSecret(`use ${pat}`, pat, "GitHub token");
  });

  it("flags Anthropic and OpenAI keys, and does not call an Anthropic key an OpenAI key", () => {
    const anthropic = `sk-ant-${MIXED.slice(0, 20)}`;
    const findings = expectSecret(anthropic, anthropic, "Anthropic API key");
    expect(findings[0]?.message).not.toContain("OpenAI");

    const openai = `sk-${MIXED.slice(0, 20)}`;
    expectSecret(openai, openai, "OpenAI API key");
    const project = `sk-proj-${MIXED.slice(0, 24)}`;
    expectSecret(project, project, "OpenAI API key");
  });

  it("flags Slack, Stripe, and Google keys", () => {
    const slack = `xoxb-${"c".repeat(12)}`;
    expectSecret(slack, slack, "Slack token");
    const stripe = `sk_live_${"d".repeat(16)}`;
    expectSecret(stripe, stripe, "Stripe API key");
    expectSecret(`rk_live_${"e".repeat(16)}`, `rk_live_${"e".repeat(16)}`, "Stripe API key");
    const google = `AIza${"f".repeat(35)}`;
    expectSecret(google, google, "Google API key");
  });

  it("flags a private key header and a JWT", () => {
    const header = "-----BEGIN RSA PRIVATE KEY-----";
    expectSecret(header, header, "private key");
    const jwt = "eyJabcdefgh.eyJijklmnop.qrstuvwxyz";
    expectSecret(jwt, jwt, "JWT");
  });

  it("flags generic assignments and names the kind", () => {
    const password = "correcthorsebattery";
    const findings = expectSecret(`password=${password}`, password, "password");
    expect(findings[0]?.column).toBe(1);

    expectSecret(`api_key: "${MIXED}"`, MIXED, "API key");
    expectSecret(`access-key=${MIXED}`, MIXED, "access key");
    expectSecret(`secret=${MIXED}`, MIXED, "secret");
  });

  it("reports an assignment that also matches a specific pattern only once", () => {
    const openai = `sk-proj-${MIXED.slice(0, 24)}`;
    const openaiFindings = expectSecret(`OPENAI_API_KEY=${openai}`, openai, "OpenAI API key");
    expect(openaiFindings[0]?.message).not.toContain("Possible API key");

    const github = `ghp_${"a".repeat(36)}`;
    const githubFindings = expectSecret(`GITHUB_TOKEN=${github}`, github, "GitHub token");
    expect(githubFindings).toHaveLength(1);
    expect(githubFindings[0]?.message).not.toMatch(/Possible token found/);

    const stripe = `sk_live_${"d".repeat(16)}`;
    expectSecret(`api-key=${stripe}`, stripe, "Stripe API key");
  });

  it("still reports two non-overlapping secrets on one line", () => {
    const aws = "AKIAABCDEFGH12345678";
    const password = "correcthorsebattery";
    const findings = secretFindings(`${aws} password=${password}`);
    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.message).join("\n")).toContain("AWS access key");
    expect(findings.map((finding) => finding.message).join("\n")).toContain("password");
    for (const finding of findings) {
      expect(finding.message).not.toContain(aws);
      expect(finding.message).not.toContain(password);
    }
  });

  it.each([
    ["your", `password=your-secret-key`],
    ["example", `api_key=example-value-ok`],
    ["changeme", `secret=changemechangeme`],
    ["dummy", `token=dummy-token-value`],
    ["redacted", `access_key=redacted-value-ok`],
    ["placeholder", `password=placeholder-value`],
    ["fake", `api-key=fake-key-value-xx`],
    ["xxxx", `password=xxxx-xxxx-xxxx`],
    ["angles", "password=<super-secret>"],
    ["substitution", "password=${MY_SECRET_VALUE}"],
    ["mustache", "token={{secret-value-here}}"],
    ["repeated", "password=aaaaaaaaaaaa"],
  ])("does not flag a %s placeholder", (_label, line) => {
    expect(secretFindings(line)).toEqual([]);
  });

  it("does not flag a specific-looking placeholder value", () => {
    const key = `sk-${"example".repeat(5)}`;
    expect(secretFindings(key)).toEqual([]);
    expect(secretFindings(`ghp_${"exampleexampleexampleexampleexampleex"}`)).toEqual([]);
  });

  it("does not flag values that are too short or lack a word boundary", () => {
    expect(secretFindings("password=short")).toEqual([]);
    expect(secretFindings("ghp_abc")).toEqual([]);
    expect(secretFindings("AKIA123")).toEqual([]);
    expect(secretFindings("xoxb-short")).toEqual([]);
    expect(secretFindings("sk_live_short")).toEqual([]);
    expect(secretFindings("XAKIAABCDEFGH12345678")).toEqual([]);
    expect(secretFindings("the word password appears here")).toEqual([]);
  });

  it("flags a secret inside a fenced block and never prints the full value", () => {
    const secret = `sk-${MIXED.slice(0, 20)}`;
    const findings = secretFindings("```txt\n" + secret + "\n```");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message.includes(secret)).toBe(false);
  });
});
