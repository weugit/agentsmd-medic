# Contributing

Thanks for helping with agentsmd-medic. This project lints `AGENTS.md` instruction files. It is a TypeScript ESM package with no runtime dependencies.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

Install Node.js 22.12 or newer, then:

```bash
git clone https://github.com/weugit/agentsmd-medic.git
cd agentsmd-medic
npm ci
npm run build
```

`npm ci` installs from `package-lock.json`. Use npm in this repository. The `consistent-package-manager` rule warns when instruction files name a different package manager than the lockfile.

## Scripts

| Script | What it runs |
| --- | --- |
| `npm run build` | `tsc -p tsconfig.build.json` into `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (`eslint.config.js`) |
| `npm test` | Vitest once (`vitest.config.ts`, `test/**/*.test.ts`) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run check` | lint, typecheck, and test |
| `npm run selfcheck` | build, then `node bin/agentsmd-medic.js .` |
| `npm run prepublishOnly` | `npm run check` and `npm run build` |

The bin entry `bin/agentsmd-medic.js` imports `dist/cli.js`. Run `npm run build` before `node bin/agentsmd-medic.js`.

## Add a rule

1. Create a module under `src/rules/`, for example `src/rules/heading-increment.ts`. Export a `Rule` (`src/types.ts`):

   - `id`: lowercase words separated by hyphens
   - `description`: one sentence, shown by `--list-rules` and in the README table
   - `defaultSeverity`: `"error"` or `"warn"`
   - `check(ctx)`: return `{ message, line, column }[]`. Do not set `ruleId` or `severity`. `src/linter.ts` adds those.

   `ctx` is a `RuleContext`: absolute `file`, absolute lint `root`, parsed `doc`, and `config`. Read paths and `package.json` from disk only when the rule needs the repository. Follow `src/rules/paths.ts` and `src/rules/scripts.ts`.

2. Register the rule in the `rules` array in `src/rules/index.ts`. Import it at the top of that file and append it to the array. `ruleMap` is built from that array. Unknown ids in a config file are rejected, so the id has to be in this list.

3. Add tests under `test/` so the path matches `test/**/*.test.ts` (see `vitest.config.ts`). Cover a document that reports the rule and one that does not. Prefer `lintText` from `src/linter.ts` with a small `Config` over spawning the CLI, unless the change is in `src/cli.ts`.

4. Run `npm test` and `npm run typecheck`.

5. Add a row to the rules table in `README.md`. Use the id, the default severity, and the `description` string.

6. Add an entry under `## [Unreleased]` in `CHANGELOG.md`.

7. If you mention new paths or commands in `AGENTS.md`, run `npm run selfcheck`. `README.md` and `CONTRIBUTING.md` are not linted. `AGENTS.md` is.

Keep the package free of runtime dependencies. A dev dependency needs a reason in the pull request.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```text
feat(rules): add heading-increment
fix(cli): reject a negative max-warnings value
docs: describe the GitHub Action inputs
test: cover duplicate sibling headings
ci: run the composite action on the repository
chore: bump the TypeScript dev dependency
```

A breaking change gets a `BREAKING CHANGE:` footer, or a `!` after the type, and a major version bump when the package is released. While the version is 0.x, small breaking changes may ship as minor versions. Say so in the changelog.

## Changelog

User-facing changes go under `## [Unreleased]` in `CHANGELOG.md` as the change is made. When a version is released, move those items into a `## [x.y.z] - YYYY-MM-DD` section and add a compare link at the bottom. Follow Keep a Changelog 1.1.0 and Semantic Versioning.

## Pull requests

- Describe the behavior change and how you tested it.
- Run `npm run check` before asking for review.
- Run `npm run selfcheck` when `AGENTS.md` or rule behavior changed.
- Do not commit `dist/`. CI runs `npm run build`.
- Do not add secrets, access tokens, or real credentials to fixtures.

## Security

Report vulnerabilities through [private advisories](https://github.com/weugit/agentsmd-medic/security/advisories/new). See [SECURITY.md](SECURITY.md). Do not file a public issue for a security bug.
