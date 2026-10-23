/**
 * Reading the user's configured preset, and (only when asked) persisting one.
 *
 * The registry resolves "which preset for a new session" from
 * `selectedDefault ?? default`:
 *
 * - `default` is the deployment default this bundle's patch declares;
 * - `selectedDefault` is the volatile **user** field, persisted into the active
 *   profile's Cordis patch by the settings service — exactly what the Web
 *   settings UI writes when a user picks "default for later sessions".
 *
 * So the no-flag path already reuses the user's setting; `--agentmode` only
 * overrides it for one launch. What a CLI user lacks is a way to *write* that
 * setting for a profile that has no settings UI (the ACP profile), which
 * `--remember` provides through the same public `settings.update` call.
 *
 * Everything here is optional: a profile without a settings service still runs,
 * it simply reports the source as unknown and refuses `--remember` loudly.
 */

import { EXIT, ROW, TIMING } from './constants.ts'
import { AgentModeError, CODES } from './errors.ts'
import { describeError } from './sanitize.ts'
import type { SettingsPort } from './ports.ts'

/** Where the effective default came from. */
export type DefaultSource = 'user' | 'override' | 'deployment' | 'unknown'

/** Read one settings form field object, if the service and the entry exist. */
function formOf(settings: SettingsPort | undefined, key: 'user' | 'value'): unknown {
  if (settings === undefined) return undefined
  try {
    return settings.describe().find((entry) => entry.ns === ROW.registry)?.[key]
  } catch {
    return undefined
  }
}

/** Whether a form contributes a `selectedDefault`. */
function carriesDefault(form: unknown): boolean {
  if (form === null || typeof form !== 'object') return false
  return (
    Object.hasOwn(form, 'selectedDefault') &&
    (form as { selectedDefault?: unknown }).selectedDefault !== undefined
  )
}

/**
 * Classify where the profile's effective preset default comes from.
 *
 * The settings service reports both the **profile override** (`user`, the layer
 * `--remember` and the Web UI write) and the **effective value** (`value`),
 * whose remaining inputs are the shared home patch and command-line overlays.
 * A value that only the effective form carries therefore came from one of those
 * higher-precedence layers, not from this profile.
 */
export function effectiveDefaultSource(settings: SettingsPort | undefined): DefaultSource {
  const user = formOf(settings, 'user')
  if (user === undefined) return 'unknown'
  if (carriesDefault(user)) return 'user'
  return carriesDefault(formOf(settings, 'value')) ? 'override' : 'deployment'
}

/** Human-readable source, for the startup diagnostic. */
export function describeSource(source: DefaultSource): string {
  switch (source) {
    case 'user':
      return 'user setting'
    case 'override':
      return 'home/command-line override'
    case 'deployment':
      return 'deployment default'
    default:
      return 'source unknown'
  }
}

/** Reject after `ms` without holding the process open. */
function rejectAfter(ms: number, message: string): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    timer.unref?.()
  })
}

/**
 * Persist `preset` as this profile's default through the public settings API.
 * @throws {AgentModeError} `E_SETTINGS` when the profile cannot persist it.
 */
export async function rememberPreset(
  settings: SettingsPort | undefined,
  preset: string,
): Promise<void> {
  if (settings === undefined) {
    throw new AgentModeError(
      CODES.settings,
      '--remember needs the settings service, which this profile does not compose',
      EXIT.environment,
    )
  }
  try {
    await Promise.race([
      settings.update(ROW.registry, { selectedDefault: preset }),
      rejectAfter(TIMING.settingsMs, 'the settings write did not finish in time'),
    ])
  } catch (error) {
    throw new AgentModeError(
      CODES.settings,
      `could not remember agent preset "${preset}": ${describeError(error)}`,
      EXIT.environment,
      { cause: error },
    )
  }
}
