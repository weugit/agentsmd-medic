# agentsmd-lint

Lint [AGENTS.md](https://agents.md) files: the instruction files AI coding agents read from a repository.

[![CI](https://github.com/weugit/agentsmd-lint/actions/workflows/ci.yml/badge.svg)](https://github.com/weugit/agentsmd-lint/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/agentsmd-lint)](https://www.npmjs.com/package/agentsmd-lint)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

agentsmd-lint checks those instructions before an agent follows them. It flags empty files, broken links, paths and commands that are not in the repo, mixed package managers, unfinished placeholders, and credential-shaped strings. It is a TypeScript ESM CLI with no runtime dependencies.

The npm package is not published yet. See [Install](#install).

## Why

[AGENTS.md](https://agents.md) is the open format read by OpenAI Codex, Cursor, GitHub Copilot, and others. Codex merges `AGENTS.md` files from the repository root down to the working directory. A closer file takes precedence. `AGENTS.override.md` overrides. Project docs are capped at 32 KiB by default via `project_doc_max_bytes`.

Stale paths, stale commands, leaked secrets, and contradictions do not fail the agent run. They silently degrade what the agent does. This linter checks the files on your machine and prints a report. It does not upload them.

## Install

After the package is on npm:

```bash
npx agentsmd-lint
npm install -D agentsmd-lint
```

It is not published yet. Until then, clone the repository and run the built CLI:

```bash
git clone https://github.com/weugit/agentsmd-lint.git
cd agentsmd-lint
npm ci && npm run build && node bin/agentsmd-lint.js
```

Node.js 20 or newer is required.

## Usage

```text
agentsmd-lint [options] [path...]
```

A path that is a file is linted directly. A path that is a directory is searched recursively for `AGENTS.md` and `AGENTS.override.md`. The default path is `.`.

| Flag | Meaning |
| --- | --- |
| `-c, --config <file>` | Config file. When omitted, the working directory is searched for `.agentsmd-lint.json`, then `agentsmd-lint.config.json`. |
| `--format <format>` | `text` (default), `json`, or `github`. |
| `--json` | Alias for `--format json`. When both are set, the last one wins. |
| `--max-warnings <n>` | Exit 1 when the warning count is greater than `<n>`. `<n>` is an integer ≥ 0. Without this flag, warnings do not change the exit code. |
| `--color` | Force colored text output. |
| `--no-color` | Disable colored text output. |
| `-q, --quiet` | Hide warnings in text output. Hidden warnings are left out of the summary. They still count toward the exit code. |
| `--list-rules` | Print each rule id, its default severity, and its description, then exit. |
| `-h, --help` | Show help and exit. |
| `-v, --version` | Show the version number and exit. |

Color defaults to on when stdout is a TTY and `NO_COLOR` is unset. `--color` and `--no-color` override that, and the last one wins. Color applies to text output only.

`--format github` prints one [GitHub Actions workflow command](https://docs.github.com/en/actions/reference/workflow-commands-for-github-actions) per diagnostic (`::error` or `::warning` with `file`, `line`, `col`, and `title`). `--format json` prints a versioned document (`version`, `root`, counts, and per-file diagnostics) for editors and scripts.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No errors, and warnings do not exceed `--max-warnings`. |
| 1 | One or more errors, or more warnings than `--max-warnings`. |
| 2 | Usage error, invalid config, or a path that does not exist. The message is written to stderr and prefixed with `agentsmd-lint: `. |

## Example output

This report is the real output of `node bin/agentsmd-lint.js --no-color` in a temporary directory (exit code 1). The directory contained only the two files below.

`package.json`:

```json
{
  "name": "example",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
```

`AGENTS.md`:

```md
# Project notes

Install dependencies with `npm run compile`, then start `pnpm dev`.

The schema is in `src/schema.ts`.

Read [the missing guide](docs/guide.md) and jump to [Setup](#setup).

## Tasks

## Tasks

TODO: describe the tasks.

api_key: "correcthorsebatterystaple"
```

```text
AGENTS.md
   3:28  warning  Script `compile` is not defined in package.json.                                                            no-missing-scripts
   3:58  warning  Instructions mix npm and pnpm; agents may run the wrong one.                                                consistent-package-manager
   3:58  warning  Script `dev` is not defined in package.json.                                                                no-missing-scripts
   5:19  warning  Referenced path `src/schema.ts` does not exist                                                              no-missing-paths
   7:6   error    Broken link: "docs/guide.md" (resolved to docs/guide.md) does not exist.                                    no-broken-links
   7:53  error    Anchor "#setup" does not match any heading in this file.                                                    no-broken-links
   9:1   warning  Section "Tasks" is empty.                                                                                   no-empty-section
  11:1   warning  Duplicate heading "Tasks" (first defined on line 9); merge the sections to avoid conflicting instructions.  no-duplicate-heading
  13:1   warning  Placeholder text "TODO" found; agents may follow it literally.                                              no-placeholder
  15:1   error    Possible API key found ("corr…"); remove it and rotate the credential.                                      no-secrets

✖ 10 problems (3 errors, 7 warnings)
```

## Rules

Default severities come from the rule objects in `src/rules/`. Override them in config with `error`, `warn`, or `off`.

| Rule | Default | Description |
| --- | --- | --- |
| `no-empty-file` | error | The file must contain some instructions. |
| `require-heading` | warn | Use at least one Markdown heading so agents (and humans) can navigate sections. |
| `max-size` | warn | Keep the file within the size agents actually read. |
| `no-empty-section` | warn | Headings should be followed by content before the next heading of the same or higher level. |
| `no-duplicate-heading` | warn | Sibling sections should not share a heading; duplicated sections often carry conflicting instructions. |
| `no-placeholder` | warn | Flag unfinished placeholder text (TODO, TBD, lorem ipsum, &lt;insert ...&gt;). |
| `no-broken-links` | error | Relative links and in-page anchors must resolve. |
| `no-missing-paths` | warn | File paths in inline code should exist in the repository. |
| `no-missing-scripts` | warn | Package scripts and Make targets mentioned in commands should exist. |
| `no-secrets` | error | Instruction files must not embed credentials or secret tokens. |
| `consistent-package-manager` | warn | Commands should use one package manager, the one the repository locks. |

`no-broken-links` checks relative links and in-page anchors. External URLs are left alone. `no-missing-paths` checks inline code that looks like a repository path. `no-missing-scripts` checks `npm run` scripts (and `pnpm` / `yarn` / `bun` script invocations) against the nearest `package.json`, and `make` targets against a Makefile. `no-secrets` reports a short prefix of a match and asks you to rotate the credential. `max-size` compares the file with `maxBytes` (default 32768) and a rough token estimate (`maxTokens`, default 8000, counted as characters / 4).

Discovery always skips these directory names: `.git`, `node_modules`, `.hg`, `.svn`, `dist`, `build`, `coverage`, `.next`, `.turbo`, `vendor`, `.venv`, `venv`, `__pycache__`, and `target`.

## Configuration

Put one of these files in the working directory. The first match wins:

1. `.agentsmd-lint.json`
2. `agentsmd-lint.config.json`

```json
{
  "rules": {
    "no-secrets": "error",
    "max-size": "warn",
    "no-placeholder": "off"
  },
  "ignore": ["fixtures", "docs/drafts"],
  "maxBytes": 32768,
  "maxTokens": 8000
}
```

| Field | Meaning |
| --- | --- |
| `rules` | Map of rule id to `error`, `warn`, or `off`. Unknown ids are a usage error (exit 2). |
| `ignore` | Directory names or path prefixes, relative to the lint root, to skip while searching. A value without a slash matches any path segment. A value with a slash matches that path or anything under it. |
| `maxBytes` | Soft size limit in bytes. Default `32768` (32 KiB). Must be a positive number. |
| `maxTokens` | Soft token budget, estimated as characters / 4. Default `8000`. Must be a positive number. |

Pass `-c` / `--config` to use a different file. If that path cannot be read, the CLI exits 2.

### Inline disable comments

In an `AGENTS.md` file:

```text
<!-- agentsmd-lint-disable -->
<!-- agentsmd-lint-disable rule-a, rule-b -->
<!-- agentsmd-lint-disable-next-line -->
<!-- agentsmd-lint-disable-next-line rule-a, rule-b -->
```

`agentsmd-lint-disable` disables every rule, or the named rules, for the whole file. `agentsmd-lint-disable-next-line` does the same for the next non-blank line. Comments inside fenced code blocks are not treated as directives, so an example in a fence does not silence a real finding.

## Use in CI

The composite action in this repository checks out its own source, installs it, builds it, and lints the caller workspace. Pin `v0` after the first release. That tag is force-moved onto each 0.x release. Leaving `version` empty (the default) builds the action's checked-out source, so the action does not need the npm package.

```yaml
name: AGENTS.md
on: [push, pull_request]
permissions:
  contents: read
jobs:
  agentsmd:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: weugit/agentsmd-lint@v0
        with:
          path: .
          # config: .agentsmd-lint.json
          # max-warnings: "0"   # -1, the default, does not fail on warnings
          format: github
          # version: "0.1.0"   # empty builds the checked-out action source
```

| Input | Default | Meaning |
| --- | --- | --- |
| `path` | `.` | File or directory to lint. |
| `config` | empty | Config file. Empty uses the default search. |
| `max-warnings` | `-1` | Fail when warnings exceed this integer. `-1` means unlimited. |
| `format` | `github` | `text`, `json`, or `github`. |
| `version` | empty | npm version to run. Empty builds the action source. |

The same check after the package is published, without the action:

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: npx agentsmd-lint --format github
```

`npx agentsmd-lint` works only once the package is on npm. Until then, use the action with an empty `version`, or the clone-and-build install above.

## Programmatic API

The package is ESM. Import it after `npm run build`, or from the published package once that exists. Types are in `dist/index.d.ts`.

```js
import { formatText, lint } from "agentsmd-lint";

const result = await lint({ cwd: process.cwd(), paths: ["."] });
process.stdout.write(formatText(result, { color: false }));
if (result.errorCount > 0) process.exitCode = 1;
```

| Export | Role |
| --- | --- |
| `lint({ cwd, paths?, configPath? })` | Load config, discover files, and return a `LintResult`. `configPath` is set on the result when a config file was read. Missing paths throw. Unknown rule ids throw `ConfigError`. |
| `lintFiles(files, root, config)` | Lint already-resolved files. |
| `lintText(source, { file, root, config })` | Lint one document from a string. Returns `Diagnostic[]`. |
| `formatText(result, { color?, quiet? })` | Text report. |
| `formatJson(result)` | JSON report (`version: 1`). |
| `formatGithub(result, cwd)` | GitHub Actions workflow commands. Paths are relative to `cwd`. |
| `loadConfig(root, explicitPath?)` | Returns `{ config, path? }`. |
| `DEFAULT_CONFIG` | `{ rules: {}, ignore: [], maxBytes: 32768, maxTokens: 8000 }`. |
| `CONFIG_FILE_NAMES` | `[".agentsmd-lint.json", "agentsmd-lint.config.json"]`. |
| `AGENT_FILE_NAMES` | `["AGENTS.md", "AGENTS.override.md"]`. |
| `findAgentFiles(root, ignore?)` | Recursive discovery. |
| `rules`, `ruleMap` | Built-in rules, in report order, and a map keyed by id. |
| `parseMarkdown(source)`, `slugify(text)` | The small Markdown scan the rules use. |
| `main(argv, io?)` | CLI entry. Resolves to exit code 0, 1, or 2. |
| `ConfigError` | Thrown for invalid config. |

Types exported from the package include `Severity`, `RuleSetting`, `Diagnostic`, `Config`, `Rule`, `RuleContext`, `LintResult`, and `FileResult`.

## Roadmap

Not implemented yet:

- Awareness of other instruction files (`CLAUDE.md`, `.cursorrules`, copilot instructions).
- Precedence analysis across nested `AGENTS.md` files (closer files and `AGENTS.override.md`).
- Autofix.
- SARIF output.
- A pre-commit hook.
- Editor integration.
- Semantic conflict detection (instructions that disagree, beyond duplicate headings and mixed package managers).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, scripts, and how to add a rule. The code of conduct is [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security reports go through [private advisories](https://github.com/weugit/agentsmd-lint/security/advisories/new) ([SECURITY.md](SECURITY.md)).

This repository's own [AGENTS.md](AGENTS.md) is linted in CI. `README.md` and `CONTRIBUTING.md` are not.

## License

[MIT](LICENSE). Copyright (c) 2026 weugit.
