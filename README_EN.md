# dsh-acp-agentmode

Adds one flag to `dsh --profile acp` (the automation-only Agent Client Protocol app): **choose the agent preset at launch**.

```bash
dsh --profile acp --agentmode cordis     # every new session in this process runs the cordis preset
dsh --profile acp                        # the profile's configured preset (this bundle defaults to standard)
dsh --profile acp --list-agentmodes      # list the presets this profile declares
```

**Nothing is persisted by default.** With no flag, the profile's _user-configured_ preset is reused and the log says where it came from; `--agentmode` overrides one launch; only an explicit `--remember` writes the choice into this profile.

Toolchain: **Vite+ 1.3** (`vp check` / `vp test` / `vp pack`), **pnpm**, **TypeScript 7**, zero runtime dependencies.

## Build, install, remove

```bash
pnpm install        # toolchain only (vite-plus / typescript / vitest / @types/node)
pnpm build          # vp pack -> dist/index.mjs + dist/index.d.mts + sourcemap
git clone https://github.com/MangMax/dsh-acp-agentmode.git
dsh plugin --profile acp add ./dsh-acp-agentmode
```

- You can also install the tarball attached to a GitHub Release: `dsh plugin --profile acp add ./dsh-acp-agentmode-0.3.0.tgz` (not published to npm on purpose: the package only makes sense inside the acp profile).
- The bundle belongs to the **acp** profile. The in-app `plugin_manager` only reaches the current profile (`desktop` here), so use the CLI.
- Installation writes the package into the profile's `dependencies` and appends `dsh-acp-agentmode` to the **end** of `dsh.profile.bundles`; patch layers apply in order, and only a layer after `@deepseek-ai/dsh-acp-app` can override its rows.
- The profile links this checkout, so **`pnpm build` is required after a code change**: the harness loads `dist/index.mjs` through the package `exports`.
- Remove with `dsh plugin --profile acp remove dsh-acp-agentmode`; the profile returns to a zero-option ACP app.

## Commands

| Command                             | What it does                                                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check` / `pnpm check:fix`     | `vp check`: format + oxlint (type-aware) + tsc type check                                                                              |
| `pnpm test`                         | `vp test`: 69 unit tests over pure logic and hand-written fake ports                                                                   |
| `pnpm build`                        | `vp pack`: ESM library build with `.d.mts` and sourcemap                                                                               |
| `pnpm smoke -- --agentmode minimal` | Real end-to-end smoke: boots `dsh --profile acp`, drives `initialize -> session/new`, then asserts the preset from the **session log** |
| `pnpm sync-presets`                 | Re-snapshot the four shipped preset declarations from the installed `@deepseek-ai/dsh-web-app`                                         |
| `pnpm verify`                       | `check && test && build` (the `prepack` gate)                                                                                          |

## Module map

```
src/constants.ts   limits, exit codes, timing budgets, preset-id grammar (one audit surface)
src/ports.ts       minimal structural interfaces for the four collaborators (no cordis version binding)
src/args.ts        strict argument parsing (pure)
src/sanitize.ts    diagnostic hygiene (ANSI/control characters/newlines/paths)
src/errors.ts      error codes and the single exit-code mapping
src/log.ts         the only stderr writer
src/selection.ts   roster wait and resolve (bounded retries)
src/compose.ts     session-to-preset binding policy (select / mount / degrade)
src/plugin.ts      Cordis adapter: guards, readiness, events, cleanup
src/index.ts       package entry (name/inject/apply plus the public error types)
tests/unit/*       pure-logic tests; tests/helpers/fakes.ts hand-written ports
scripts/sync-presets.ts, scripts/smoke-acp.ts
cordis.patch.yml + presets/*.patch.yml   composition layers
```

`ports.ts` keeps the plugin free of any specific harness version's types and makes the whole design unit-testable with fakes; `plugin.ts` is the only module that touches a real Cordis context.

## Reusing the configured preset: read / override / persist

The registry resolves "which preset for a new session" as `selectedDefault ?? default`:

- `default` is the **deployment default** this bundle's patch declares (`standard`) — a fallback only;
- `selectedDefault` is the **volatile user field** the Web settings UI writes for "default for later sessions", persisted by the settings service into the **active profile's** Cordis patch.

So the plugin already reads the user's setting; `--agentmode` only overrides one launch:

| Usage                                          | Behaviour                                                                                                               | Startup log                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `dsh --profile acp`                            | reads `selectedDefault ?? default`                                                                                      | `agent preset: ptc (user setting)` / `(home/command-line override)` / `(deployment default)` |
| `dsh --profile acp --agentmode cordis`         | overrides this launch                                                                                                   | `agent preset: cordis (from --agentmode)`                                                    |
| `dsh --profile acp --agentmode ptc --remember` | persists through the public `settings.update('agent-preset-registry', { selectedDefault })`, so later launches reuse it | `remembered agent preset: ptc`                                                               |

`--list-agentmodes` labels the default `(default, user setting)` / `(default, override)`.

**Why the desktop/web choice does not travel to ACP:** settings are persisted **per profile** (into `profileContext.patchPath`), and `dsh --profile acp` is a different profile with its own patch layer and store. To share one choice: ① run `--remember` once in the acp profile, or ② write the shared home patch `$DSH_HOME/cordis.patch.yml` (it outranks the profile patch; note that settings form writes are then refused, per the upstream `dsh-settings` README). The plugin does not read another profile's file — that would break profile isolation.

## What it changes in the profile

`cordis.patch.yml` holds four ordinary Loader patch sections:

1. **Own the command line.** Disable the shipped `acp-app-startup` row (a zero-option commander program: any extra flag is rejected with `error: unknown option`) and insert this bundle's `acp-agentmode` row, which publishes the `acpAppStartup` service the shipped `acp` row injects.
2. **Move the agent plane behind presets.** Disable the base's 23 per-agent rows (`tool-bash`, `tool-fs`, `tool-skill`, `tool-todo`, `tool-web`, `tool-subagent*`, `compaction-basic`, `agent-instructions`, `skill-filesystem`, …), the same split `@deepseek-ai/dsh-web-app/cordis.patch.yml` applies to the Web surface. An ACP process serves several sessions; those base rows exist for single-session, process-wide compositions.
3. **Insert the preset registry** (`agent-preset-registry`, `default: standard`), used only when no `--agentmode` is passed.
4. **Insert host support rows** the preset children consume but the base does not provide: `subagent-model-selection-settings`, `plugin-inventory`.

## How it works

**Command line.** `inject: ['cmdlineArgs']`, then parse strictly, run `assertAcpProfile()`, **publish readiness synchronously**, resolve the preset in the background, and arm stdin EOF only after the selection resolved (so a rejected flag still exits nonzero).

Readiness is published first on purpose: the App-level audit settles the loader tree on its own schedule, and a registry still doing I/O must not turn a valid invocation into "startup failed".

**Session composition.** `dsh-acp` creates agents with `meta: { cwd }` and never mounts a preset (the Web session controller mounts one inside its own `setup`). The composition is attached from outside on the serial `agent/created` event — which the agent loop awaits _before_ releasing queued input — by calling `agentPresets.select(agent, id)` on the blank session, the same public call the Web UI uses for a live blank session. `select` appends `agent-preset/selected` only after `recompose`/`mount` succeeded. A resumed session is past its first turn (where `select` refuses with `agent-preset/locked`), so it keeps the recorded preset and is composed with `agentPresets.mount()`.

**Two startup races** are handled: declarations register asynchronously (wait for the roster to reach the number of declaration rows, bounded), and a startup patch reload can recreate the registry row (retry only `agent-preset/not-found` with jittered backoff; `INACTIVE_EFFECT` from a replaced instance is left to its replacement). A watchdog reports `E_ENVIRONMENT` and exits if the registry never activates, instead of leaving the client with sessions that can never be composed.

## Security

| Surface           | Measure                                                                                                                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flags             | Only `--agentmode`, `--agentmode=`, `--list-agentmodes`, `-h`; repeated flags are an error (no last-wins); no positionals after `--`; unknown options are never ignored                                                                              |
| Input             | The preset id is validated (`^[A-Za-z0-9][A-Za-z0-9._-]*$`, ≤ 64 chars) **before** it reaches the registry: no whitespace, no control characters, no leading separator that anything downstream could read as a flag                                 |
| Composition guard | Startup verifies that `@deepseek-ai/dsh-acp` is composed and the shipped zero-option row is disabled; otherwise `E_ENVIRONMENT` — a bundle installed into the wrong profile fails loudly instead of hijacking another app's stdin and exit semantics |
| Publishing        | Readiness is published once; if another row already published `acpAppStartup`, this instance warns and yields instead of throwing or crashing                                                                                                        |
| Diagnostics       | Every stderr line goes through `oneLine` + `redactPaths`: ANSI/OSC and control characters stripped (terminal hijacking), newlines collapsed (log forging), length bounded, `$HOME`/`$DSH_HOME`/absolute paths replaced with `~` / `<path>`           |
| Code              | No `eval`/`Function`/dynamic import; stdin is never read (only an `end` listener, removed on dispose); `process.exit` is never called (the launcher's `appExit` is); zero runtime dependencies                                                       |
| Lifecycle         | One `AbortController` per instance: dispose aborts every wait and clears every timer, leaving no dangling handles                                                                                                                                    |
| stdout purity     | stdout has exactly two writers (`--help`, `--list-agentmodes`); ACP frames own it otherwise, and the smoke script asserts stdout carries no diagnostics                                                                                              |

## Performance

- **Zero startup blocking**: readiness is synchronous; the selection resolves in the background and the first `session/new` awaits the same promise (resolved once).
- **No busy polling**: the wait strategy is "let the Loader quiesce (bounded race), then wait for the roster by declaration count", backing off 20 ms → 160 ms, always with a deadline.
- **Zero hot-path work**: an already-composed Agent costs one `composedPreset()` check; subagent children inherit their parent's revision during their own setup and are skipped.
- **Artifact**: one ESM file, 31.6 kB (10.5 kB gzip), no runtime dependencies, no top-level side effects.
- **Cleanup**: every timer is registered on the instance clock and cleared on dispose.

## Error model

| Code                | Meaning                                                                                                                    | Exit |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---- |
| `E_USAGE`           | The invocation is wrong (unknown option, missing value, invalid id, repeated flag)                                         | 2    |
| `E_PRESET_UNKNOWN`  | The id is not in the roster (message lists the available ids)                                                              | 3    |
| `E_PRESET_UNUSABLE` | Declared but cannot activate (message carries the registry's reason, e.g. a missing `cordisInspect`)                       | 3    |
| `E_REGISTRY`        | The registry did not answer within the budget                                                                              | 3    |
| `E_ENVIRONMENT`     | The composition is wrong (not the ACP app, shipped startup row still active, missing injections, registry never activated) | 4    |
| `E_BIND`            | One session could not be bound — a `warning` only, degrading to a preset-free composition; it never fails `session/new`    | —    |

`DSH_ACP_AGENTMODE_DEBUG=1` adds the cause chain and a sanitized stack; by default a failure is one classified line.

## Verified

Unit tests: `vp test` — **7 files / 85 cases** green (argument grammar, diagnostics sanitization, roster wait, resolve classification and retries, blankness predicate, bind degradation, default-source classification and the `--remember` write, and `apply()` behaviour for help, guards, publishing, listing and duplicate publishes).

Static gate: `vp check` — format + type-aware oxlint + tsc, **0 errors / 0 warnings**.

Real end-to-end (0.2.1-rc.2 on this machine, minimal ACP client, no model call):

| Case                                      | Result                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `--agentmode standard/minimal/ptc/cordis` | session created; the log records `agent-preset/selected: standard/minimal/ptc/cordis`              |
| no flag                                   | default `standard`                                                                                 |
| `--agentmode nope`                        | exit 3, `E_PRESET_UNKNOWN: unknown agent preset "nope"; available: standard, ptc, minimal, cordis` |
| `--bogus`                                 | exit 2, `E_USAGE: unknown option "--bogus"`                                                        |
| `--list-agentmodes` / `--help`            | exit 0, correct output                                                                             |
| `session/resume` (blank session)          | succeeds, composition follows the recorded preset                                                  |
| `pnpm smoke -- --agentmode minimal`       | passes (the script asserts against the session log itself)                                         |
| stdout purity                             | the client received JSON-RPC frames only                                                           |

Not exercised: the **non-blank** `session/resume` branch (the `mount` path) needs one real model turn first.

## Known limits

- **Settings are isolated per profile**: `selectedDefault` exists only in the profile that wrote it; there is no cross-profile store (desktop/web/acp are independent on the same machine). A shared home patch unifies them, at the cost of the Web form no longer being able to change that field.
- **Process-level granularity.** One preset per `dsh --profile acp`. Per-session selection by an ACP client would require changing `dsh-acp` (the SDK preserves `_meta` on `session/new`, but the bridge ignores it) — not expressible by a plugin.
- **Presets do not carry a model.** They compose tools, prompt sections, skills, compaction and delegation; the model still comes from the `acp` row / `agent-default-model`, and the client can set `model`/`reasoning_effort` through `session/set_config_option`.
- Two child rows are unusable on this surface and are disabled in the snapshots, keeping the upstream text: `tool-schedule` (its `schedule` provider needs the Web-only `sessionController`) and `tool-cordis` (needs the Web-only inspector `cordisInspect`). The `cordis` preset therefore works without the cordis runtime-query tool.
- The disable list mirrors the Web surface. If upstream _renames_ a row the patch becomes a warned no-op; if upstream _adds_ an agent-plane row it stays on the host plane and is shadowed by the preset's same-named row, possibly at extra token cost — worth one comparison after a harness upgrade.
- The desktop UI's `plugin_manager` does not list it (different profile); `locale/` and `icon.svg` exist for inventory completeness, and their rendering cannot be checked from the desktop UI.

## Maintenance

```bash
pnpm sync-presets                       # re-snapshot from the installed harness
pnpm sync-presets /path/to/dsh-web-app  # or point at a package directory
```

The script regenerates the four declarations for the current harness and applies the documented `disabled: true` adaptation for rows this surface cannot host. After a harness upgrade, run `pnpm verify && pnpm smoke` once.

## Public API used

`ctx.cmdlineArgs` / `ctx.appExit` / `ctx.appReady`, `ctx.agentPresets.{list,resolve,select,mount,composedPreset,defaultId}`, `ctx.sessionProjections.stateOf(session, 'agentPreset' | 'turnBoundary')`, the serial `agent/created` event, and the Loader's `entries()` / `await()`. All public contracts; no internals touched.

## Contributing and security

- Development: see [CONTRIBUTING.md](CONTRIBUTING.md); the local gate is `pnpm verify`. `dist/` is not committed — releases build it.
- Vulnerabilities: use the private channel in [SECURITY.md](SECURITY.md); never a public issue.
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

`main` is protected: every change lands through a pull request with green CI and a maintainer's approval.

MIT License.
