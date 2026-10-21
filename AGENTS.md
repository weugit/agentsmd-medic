# agentsmd-medic

agentsmd-medic checks AGENTS.md and AGENTS.override.md files. Those files are the instructions coding agents read from a repository. This repository is the linter, and this file is linted by the tool itself.

## Overview

The package is a TypeScript ESM command-line tool with no runtime dependencies. It discovers instruction files, parses a small subset of Markdown, and runs the rules registered in `src/rules/index.ts`. Node.js 22.12 or newer is required. The `engines` field in `package.json` says so.

OpenAI Codex, Cursor, GitHub Copilot, Jules, and Aider read AGENTS.md. Codex reads one file per directory from the git root down to the working directory: AGENTS.override.md if that directory has one, otherwise AGENTS.md. It concatenates those files from the root toward the leaf. Codex caps project docs at 32 KiB by default (`project_doc_max_bytes`). The `max-size` rule uses that byte limit. Its token estimate counts each Han, Hiragana, Katakana, Hangul, and fullwidth character as one token and counts other text as characters divided by 4.

`agentsmd-medic doctor` reports which instruction files Codex, Claude Code, Cursor, GitHub Copilot, and Gemini CLI would load for a directory. The walk stops at the git root, the nearest ancestor that contains .git. Documented behavior for those agents lives in `src/agents.ts`. The scan lives in `src/doctor.ts`.

Human-facing docs live in [README.md](README.md). Contribution steps live in [CONTRIBUTING.md](CONTRIBUTING.md).

## Setup

Clone the repository and install dependencies with npm. The lockfile is `package-lock.json`. Use npm for every command in this repo.

```bash
npm ci
npm run build
```

The executable is `bin/agentsmd-medic.js`. It loads the compiled program from `dist/cli.js`. Run `npm run build` after changing anything under `src/` and before invoking the CLI.

## Commands

Scripts in `package.json`:

- `npm run build` compiles with `tsconfig.build.json`.
- `npm run typecheck` runs the TypeScript compiler with `--noEmit`.
- `npm run lint` runs ESLint using `eslint.config.js`.
- `npm test` runs Vitest once. Config is `vitest.config.ts`.
- `npm run test:watch` runs Vitest in watch mode.
- `npm run check` runs lint, typecheck, and the test script.
- `npm run selfcheck` builds and then lints this repository.
- `npm run prepublishOnly` runs `npm run check` and `npm run build`.

Lint this repository:

```bash
npm run build
node bin/agentsmd-medic.js --no-color .
```

A clean run exits 0. `node bin/agentsmd-medic.js --help` prints flags and exit codes. `node bin/agentsmd-medic.js --list-rules` prints each rule id, its default severity, and its description.

Report which instruction files agents would load here:

```bash
node bin/agentsmd-medic.js doctor .
```

`doctor` exits 0 when the directory can be read. Warnings in that report do not change the exit code.

## Layout

- `bin/agentsmd-medic.js` is the bin entry. It calls `main` from `dist/cli.js`.
- `src/cli.ts` parses arguments and chooses the exit code.
- `src/index.ts` is the programmatic API.
- `src/config.ts` loads a JSON config from the working directory. The file names, in order, are .agentsmd-medic.json and agentsmd-medic.config.json.
- `src/discover.ts` walks the tree for AGENTS.md and AGENTS.override.md.
- `src/agents.ts` records documented instruction-file behavior and links to each agent's docs.
- `src/doctor.ts` reports which of those files each agent loads from a directory up to the git root.
- `src/linter.ts` runs rules and honors inline disable comments.
- `src/markdown.ts` scans headings, links, and code spans.
- `src/format.ts` renders text, JSON, and GitHub Actions workflow commands.
- `src/types.ts` holds the shared types.
- `src/rules/index.ts` lists the rules. Report order starts there, then diagnostics are sorted by line and column.
- Rule modules: `src/rules/structure.ts`, `src/rules/links.ts`, `src/rules/paths.ts`, `src/rules/scripts.ts`, `src/rules/secrets.ts`, and `src/rules/package-managers.ts`. Shared helpers live in `src/rules/util.ts`.
- `action.yml` is the composite GitHub Action.
- Workflows: `.github/workflows/ci.yml` and `.github/workflows/release.yml`.
- Also at the root: `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and `LICENSE`.

## Adding a rule

1. Add a `Rule` in a module under `src/rules/`. Copy the shape from `src/rules/structure.ts`: `id`, `description`, `defaultSeverity` (`error` or `warn`), and `check`.
2. Import that rule and append it to the `rules` array in `src/rules/index.ts`.
3. Add a Vitest file whose path matches `test/**/*.test.ts`. Cover a document that should report the rule and one that should not. `vitest.config.ts` sets that include pattern.
4. Run `npm test` and `npm run typecheck`.
5. Add the rule to the table in `README.md` and add an entry under Unreleased in `CHANGELOG.md`. The steps are also written in `CONTRIBUTING.md`.
6. Run `npm run selfcheck` so this file still reports no problems.

`check` receives a `RuleContext` (`file`, `root`, `doc`, `config`) and returns objects with `message`, `line`, and `column`. Do not set `ruleId` or `severity` on those objects. `src/linter.ts` adds them from the rule and the config.

Disable comments are parsed in `src/linter.ts`. A comment inside a fenced code block does not count. Whole-file and next-line forms take an optional comma-separated rule list. The sample below is fenced so it does not silence this file:

```text
<!-- agentsmd-medic-disable rule-id -->
<!-- agentsmd-medic-disable-next-line rule-id -->
```

Config may set a rule to error, warn, or off. An unknown rule id throws, and the CLI exits 2.

## Testing

`npm test` runs every file matching `test/**/*.test.ts`. Prefer a direct call to `lintText` for rule behavior. Use the CLI only when the change is argument parsing or output format.

`npm run check` is the gate `prepublishOnly` runs before publish. See `package.json`.

## Style

TypeScript is strict. `tsconfig.json` enables `noUncheckedIndexedAccess`. Modules are ESM with NodeNext resolution, so relative imports end in the .js suffix even though the source file is TypeScript. The package has no runtime dependencies. Keep new code on the Node.js standard library.

ESLint is configured in `eslint.config.js`. An unused variable is an error unless the name starts with an underscore. `dist/` is generated. Do not edit it by hand.

Commit messages follow Conventional Commits. Examples: `feat(rules): add a heading-level check` and `fix(cli): reject a bad format`. Put user-facing changes under Unreleased in `CHANGELOG.md`.

## Pull requests

- Explain the behavior change.
- Add or update tests for code under `src/`.
- Run `npm run check`.
- If you edit this file, run `node bin/agentsmd-medic.js .` after `npm run build` and fix every reported problem.
- Update `CHANGELOG.md` for user-facing changes.
- Do not add a runtime dependency.
