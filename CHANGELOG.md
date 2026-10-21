# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-10-21

### Changed

- Releases are published to npm from GitHub Actions with trusted publishing (OIDC) and provenance.

- Renamed the project from `agentsmd-lint` to `agentsmd-medic`: the npm package, the CLI command, the repository (`weugit/agentsmd-medic`), the GitHub Action (`uses: weugit/agentsmd-medic@v0`), the config files (`.agentsmd-medic.json`, `agentsmd-medic.config.json`), and the inline `agentsmd-medic-disable` comments. The 0.1.0 release was never published to npm under the old name.

### Added

- `agentsmd-medic doctor [dir]` reports which instruction files OpenAI Codex, Claude Code, Cursor, GitHub Copilot, and Gemini CLI load from that directory up to the git root. Text output groups each agent with ✔ and ⚠ markers. `--json` prints a versioned document. The command exits 0 unless the invocation is invalid (exit 2).
- `max-size` estimates tokens with CJK and fullwidth characters counted as one token each and other text as characters / 4. The byte check stays UTF-8 bytes. When CJK content is more than 20% of non-whitespace characters and the file exceeds `maxBytes`, the message notes that CJK text uses 3 bytes per character in UTF-8 and reaches the 32 KiB cap with ~11k characters.

## [0.1.0] - 2026-10-21

### Added

- Command-line linter for `AGENTS.md` and `AGENTS.override.md`. A file path is linted directly. A directory is searched recursively. The default path is `.`.
- Rules: `no-empty-file`, `require-heading`, `max-size`, `no-empty-section`, `no-duplicate-heading`, `no-placeholder`, `no-broken-links`, `no-missing-paths`, `no-missing-scripts`, `no-secrets`, and `consistent-package-manager`.
- Config files `.agentsmd-medic.json` and `agentsmd-medic.config.json` with `rules`, `ignore`, `maxBytes`, and `maxTokens`.
- Inline `agentsmd-medic-disable` and `agentsmd-medic-disable-next-line` comments. Comments inside fenced code blocks are ignored.
- Output formats `text` (optional color), `json`, and `github` (GitHub Actions workflow commands).
- Exit codes: 0 clean, 1 findings, 2 usage error, invalid config, or a missing path.
- Programmatic API (`lint`, `lintFiles`, `lintText`, formatters, config loading, and the rule list).
- Composite GitHub Action (`action.yml`) that lints the caller repository.
- Zero runtime dependencies. Node.js 20 or newer.

[Unreleased]: https://github.com/weugit/agentsmd-medic/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/weugit/agentsmd-medic/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/weugit/agentsmd-medic/releases/tag/v0.1.0
