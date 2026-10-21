# Security policy

## Supported versions

Only the latest 0.x release is supported. Older 0.x releases do not receive fixes.

| Version | Supported |
| --- | --- |
| 0.x (latest release) | Yes |
| Older 0.x releases | No |

The current release is 0.1.0.

## Reporting a vulnerability

Report vulnerabilities through GitHub private vulnerability reporting:

https://github.com/weugit/agentsmd-lint/security/advisories/new

Do not open a public issue for a security report.

The maintainer aims to acknowledge a report within 3 business days and to follow up with an assessment within 14 days. Those are goals, not a promise, a service level, or a guaranteed response time.

## Scope

agentsmd-lint reads local files and writes a report to stdout or stderr. It does not upload file contents, repository contents, or diagnostics anywhere.

In scope:

- Bugs in this repository that cause the tool, the GitHub Action, or the release workflow to mishandle local input (for example parser crashes, path handling that escapes the file the user asked to read, or credential material printed in full by the `no-secrets` rule).
- The publish workflow in `.github/workflows/release.yml`, which publishes to npm through trusted publishing (OIDC) without a stored token.

Out of scope:

- Secrets a project has already written into its own `AGENTS.md`. The `no-secrets` rule only reports them on the machine where the linter runs. Remove the credential from the file and rotate it.
- Behavior of Codex, Cursor, Copilot, Jules, Aider, or any other agent that reads instruction files.
- Vulnerabilities in dependencies of a repository you lint. This tool does not install or execute that repository's dependencies.

There is no security contact email. Use the advisory link above.
