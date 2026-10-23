/**
 * Constants shared by the plugin, its tests, and the documentation.
 *
 * Everything security-relevant (limits, exit codes, timing budgets) lives here
 * so a reviewer can audit the policy in one place.
 */

/** Stable Cordis plugin name; also the Loader row id in `cordis.patch.yml`. */
export const PLUGIN_NAME = 'acp-agentmode'

/** The service the shipped `acp` row injects before it claims stdio. */
export const SERVICE_STARTUP = 'acpAppStartup'

/** Row names this plugin reasons about. */
export const ROW = {
  /** One agent preset declared as an ordinary composition row. */
  declaration: '@deepseek-ai/dsh-agent-preset',
  /** The ACP bridge itself; its presence proves this is the ACP app. */
  acpApp: '@deepseek-ai/dsh-acp',
  /** The shipped zero-option startup provider this bundle disables. */
  shippedStartup: '@deepseek-ai/dsh-acp-app',
  /** The profile entry id of the preset registry (the settings namespace). */
  registry: 'agent-preset-registry',
} as const

/** Environment switch for verbose (stack-bearing) diagnostics. */
export const DEBUG_ENV = 'DSH_ACP_AGENTMODE_DEBUG'

/**
 * Process exit codes. `2` matches conventional CLI usage errors, `3` reports a
 * preset the operator asked for but cannot get, `4` an environment/composition
 * problem this plugin cannot repair.
 */
export const EXIT = {
  usage: 2,
  preset: 3,
  environment: 4,
} as const

/** Hard limits applied to untrusted input and to diagnostics. */
export const LIMITS = {
  /** Longest accepted preset id; also enforced by `PRESET_ID_PATTERN`. */
  presetIdLength: 64,
  /** Longest diagnostic line written to stderr. */
  diagnostic: 320,
  /** Longest help/roster line written to stdout. */
  rosterLine: 200,
  /** Deepest `cause` chain walked when describing an error. */
  causeDepth: 2,
} as const

/**
 * The accepted preset-id grammar. The registry itself only rejects blank and
 * duplicate ids, so this plugin narrows the input before it ever reaches it:
 * a conservative identifier alphabet, no whitespace, no control characters,
 * no leading dash (which would be read as a flag by anything downstream).
 */
export const PRESET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Timing budgets. Every wait is bounded; none of them block startup. */
export const TIMING = {
  /** Slice spent waiting for the Loader tree to quiesce before a resolve. */
  settleSliceMs: 2_000,
  /** Overall budget for the declaration roster to finish registering. */
  rosterDeadlineMs: 20_000,
  /** Overall budget for resolving one preset id. */
  resolveDeadlineMs: 20_000,
  /** First retry delay when the roster/resolve is not ready yet. */
  pollStartMs: 20,
  /** Retry ceiling; backoff doubles until here. */
  pollMaxMs: 160,
  /** Budget for one settings write (a profile-patch edit). */
  settingsMs: 5_000,
} as const

/** Every exit code this plugin can request, for documentation and tests. */
export const EXIT_CODES: readonly number[] = [EXIT.usage, EXIT.preset, EXIT.environment]
