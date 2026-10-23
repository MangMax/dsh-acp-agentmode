# Contributing to dsh-acp-agentmode

Thanks for taking the time to contribute. This is a small, focused plugin: it gives the
automation-only ACP profile of DeepSeek Harness one flag (`--agentmode <preset>`) and keeps
the session composition honest. Small, well-tested changes are the easiest to land.

## Ground rules

- Be kind. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- Security issues go through [SECURITY.md](SECURITY.md), **never** a public issue.
- By submitting a pull request you agree your contribution is your own work, licensed under
  the MIT License that covers this repository.
- Every change lands through a pull request. `main` is protected: no direct pushes, no force
  pushes, all CI checks must pass.

## Development setup

Requirements: Node.js >= 22, pnpm 12 (the exact version is pinned in `package.json`).

```bash
git clone https://github.com/MangMax/dsh-acp-agentmode.git
cd dsh-acp-agentmode
pnpm install
pnpm verify        # vp check + vp test + vp pack — the same gate CI runs
```

The toolchain is [Vite+](https://viteplus.dev): `vp check` formats, lints (type-aware) and
type-checks; `vp test` runs Vitest; `vp pack` builds the ESM library into `dist/`.

## What to run before opening a pull request

```bash
pnpm verify        # must be green: 0 errors, 0 warnings, all tests pass
```

If your change touches the flag surface, the preset snapshot script, or the composition
layer, also run the end-to-end smoke against a local harness:

```bash
# needs a DeepSeek Harness install with this bundle installed into the acp profile
pnpm smoke -- --agentmode minimal
```

That script boots `dsh --profile acp`, drives `initialize` → `session/new` like an editor
would, then asserts the preset from the session log. It needs no model call.

## Project layout

| Path                                                                                                                     | Contract                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ports.ts`                                                                                                           | The narrow structural interfaces the plugin depends on. **Do not** import harness packages here — version coupling is an upgrade hazard. |
| `src/plugin.ts`                                                                                                          | The only module that touches a real Cordis context. Keep it thin.                                                                        |
| `src/args.ts`, `src/sanitize.ts`, `src/errors.ts`, `src/log.ts`, `src/selection.ts`, `src/compose.ts`, `src/settings.ts` | Pure logic, unit-tested without a harness.                                                                                               |
| `cordis.patch.yml`                                                                                                       | Composition layer: takes over the app's command line, moves the agent plane behind presets, mounts the registry.                         |
| `presets/*.patch.yml`                                                                                                    | **Generated.** Never hand-edit; run `pnpm sync-presets`.                                                                                 |
| `tests/unit/*`                                                                                                           | One file per module, plus `tests/helpers/fakes.ts`.                                                                                      |

## Changing behaviour

- **New or changed flag** → `src/args.ts` (the flag table is six constants), `USAGE`, and
  `tests/unit/args.test.ts`. Unknown options must keep failing loudly: a typo that silently
  falls back to the default preset is a behaviour change nobody asked for.
- **New preset** → declare an `@deepseek-ai/dsh-agent-preset` row in your own patch. The
  plugin has no allowlist; ids are read from the registry at runtime.
- **Preset content drift** → `pnpm sync-presets` after a harness upgrade, and review the
  resulting diff. Rows this surface cannot host are disabled by the script with a reason.
- **Security-relevant input** → anything reaching a diagnostic or a child process goes
  through `src/sanitize.ts` (ANSI stripping, one-line flattening, path redaction).

## Commit and PR conventions

- Commit subject: imperative mood, scoped when useful, e.g.
  `fix(args): reject a repeated --agentmode`, `feat(compose): fall back to the requested preset`.
- One logical change per pull request. Keep refactors separate from behaviour changes.
- Fill in the pull request template: **what changed**, **why**, **how it was verified**
  (paste the `pnpm verify` summary and, when relevant, the smoke output).
- CI must be green and a maintainer must approve. Squash merging is fine; the PR title
  becomes the commit subject.

## Release (maintainers)

```bash
# bump version, then
git tag v0.4.0 && git push origin v0.4.0
```

Releases are published from the tag by the maintainer; nothing is published automatically
from `main`.
