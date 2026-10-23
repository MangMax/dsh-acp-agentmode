# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private reporting channel instead: go to the repository's **Security** tab and
choose **Report a vulnerability**. That opens a private draft advisory visible only to the
maintainer.

If that channel is unavailable, open a minimal public issue that says only "security report,
please contact me" and wait for the maintainer to reach out — do not include details, proof
of concept, or the affected path in public.

Please include:

- the version or commit you tested,
- the DeepSeek Harness version and profile you ran (`dsh --version`, `--profile acp`),
- what an attacker gains, and the smallest reproduction you have.

You can expect an acknowledgement within about a week and a fix or mitigation plan after the
issue is understood. Credit is given in the release notes unless you ask otherwise.

## Scope

This plugin runs inside the DeepSeek Harness Host process with the operator's own privileges,
so the threat model is deliberately narrow:

| In scope                                                                                       | Out of scope                                                                      |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Command-line parsing flaws that let an argument bypass validation (`src/args.ts`)              | Vulnerabilities in DeepSeek Harness itself — report those to the harness project  |
| Diagnostic output that leaks secrets, paths, or terminal control sequences (`src/sanitize.ts`) | A preset or plugin the operator chose to install; presets are code, not sandboxes |
| Writes to the profile that the operator did not ask for                                        | Anything reachable only by editing the profile by hand                            |
| A composition guard that fails to stop the plugin from hijacking a non-ACP app                 | Denial of service against your own machine by your own configuration              |

Known and accepted by design, not vulnerabilities:

- `danger-full-access` (a sandbox preset the operator selects) permits writes outside the
  workspace and suppresses approvals.
- `--remember` writes `selectedDefault` into the **active profile's** Cordis patch, which is
  exactly what the settings UI does; it never touches another profile.
- The plugin does not sandbox presets: a preset's `plugins` list can execute Host code.

## Supported versions

The latest minor release on `main` receives fixes. There is no long-term support branch.
