# Good first issues

Drafts for the maintainer to file. Each one is scoped to a few files. None of them are open yet.

Do not invent usage numbers, download counts, or adopter quotes in the issues or in the docs that land with them.

## 1. Add a JSON Schema for the config file

**Context.** Config is a JSON object validated in `src/config.ts`. Allowed fields are `rules` (map of rule id to `error`, `warn`, or `off`), `ignore` (array of strings), `maxBytes`, and `maxTokens` (positive numbers). Defaults live in `DEFAULT_CONFIG`. Unknown keys are ignored, so a `$schema` property already passes the loader. There is no schema document editors can use.

**Acceptance criteria.**

- Add `schema/agentsmd-doctor.schema.json` (JSON Schema draft 2020-12) describing those four fields. `additionalProperties` may be true so `$schema` stays valid, or false if you also document that `$schema` is the one extra key you allow.
- `rules` values are only `error`, `warn`, and `off`. `ignore` items are strings. `maxBytes` and `maxTokens` are numbers greater than 0.
- README Configuration shows a `$schema` URL a user can paste (the raw GitHub URL for that file on `main` is enough).
- Do not add a runtime dependency. A test can `JSON.parse` the schema and assert the field names match `Config` in `src/types.ts`.

**File pointers.** `src/config.ts`, `src/types.ts`, `README.md`.

## 2. Support a same-line disable comment

**Context.** `src/linter.ts` understands `<!-- agentsmd-doctor-disable -->` for the whole file and `<!-- agentsmd-doctor-disable-next-line -->` for the next non-blank line. An optional comma-separated list limits which rules go quiet. Comments inside fenced code are ignored. There is no way to silence a finding on the same line as the comment.

**Acceptance criteria.**

- `<!-- agentsmd-doctor-disable-line -->` and `<!-- agentsmd-doctor-disable-line rule-a, rule-b -->` suppress every rule, or the named rules, on the line that contains the comment.
- Next-line and whole-file behavior stays as it is. A fenced sample of the new comment does not suppress real findings.
- Help text in `src/cli.ts` and the inline-comment section of `README.md` document the form.
- Tests cover a same-line hit, a named-rule list, and a fenced comment that must not suppress.

**File pointers.** `src/linter.ts`, `src/cli.ts`, `README.md`, `test/`.

## 3. Add a heading-increment rule

**Context.** `src/rules/structure.ts` already checks for a missing heading, an empty section, and duplicate sibling headings. A jump from a level-1 heading to a level-3 heading is still silent. Agents and humans both use the outline to navigate.

**Acceptance criteria.**

- New rule id `heading-increment`, default severity `warn`, implemented next to the other structure rules.
- Flag a heading whose level is greater than the previous heading's level plus one. Dropping from a deeper heading back to a shallower one is fine. A file may start at any level.
- Register it in the `rules` array in `src/rules/index.ts`.
- Tests for a jump (h1 then h3) and for a legal step (h1 then h2).
- README rules table and `CHANGELOG.md` under Unreleased mention the rule. Description is one sentence, same string the rule exports.

**File pointers.** `src/rules/structure.ts`, `src/rules/index.ts`, `src/types.ts` (the `Rule` shape), `README.md`, `CHANGELOG.md`, `test/`.

## 4. Add a repeatable `--ignore` CLI flag

**Context.** Discovery skips a built-in set of directory names in `src/discover.ts` and any `ignore` entries from config (`src/config.ts`). A name without a slash matches a path segment. A value that contains a slash is a path prefix relative to the lint root. There is no CLI way to add an ignore for one run.

**Acceptance criteria.**

- `--ignore <pattern>` may be repeated. Each value is appended to `config.ignore` after the config file is loaded. Existing config entries stay.
- Help text in `src/cli.ts` documents the flag. README Usage lists it.
- A bad invocation still exits 2 with the `agentsmd-doctor: ` prefix on stderr.
- Tests show that a directory matched by `--ignore` is not linted, and that a config `ignore` entry still applies when the flag is also set.

**File pointers.** `src/cli.ts`, `src/linter.ts` (`LintOptions` / `lint`), `src/discover.ts`, `src/config.ts`, `README.md`, `test/`.

## 5. Print the loaded config path in text output

**Context.** `lint` in `src/linter.ts` returns `configPath` when a config file was loaded. `formatText` in `src/format.ts` does not receive it, so a text report never says which file supplied `rules` or `maxBytes`. JSON output is a stable document (`version: 1`) and should stay free of a new required field unless you bump that version on purpose. This issue is text output only.

**Acceptance criteria.**

- When a config file was loaded, the text report includes one line with that path relative to the process working directory (forward slashes).
- When no config file was loaded, the report stays as it is today, including the "no problems" line and the "no AGENTS.md files" line.
- `--quiet` and color do not drop or mis-color that line into a fake diagnostic. Exit codes do not change.
- A test covers the loaded and not-loaded cases.

**File pointers.** `src/cli.ts`, `src/format.ts`, `src/linter.ts`, `test/`.
