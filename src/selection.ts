/**
 * Turning a requested preset name into a resolved identity.
 *
 * Two races are inherent to this profile and are handled here, not at the call
 * site:
 *
 * 1. **Declarations register asynchronously.** A read that lands during startup
 *    sees an empty roster and would reject a valid `--agentmode`. The number of
 *    declaration rows is known from the Loader tree, so the wait is bounded by
 *    that count and a deadline.
 * 2. **A profile patch reload recreates the registry row**, retiring and
 *    re-registering every declaration. A resolve can land in that gap and report
 *    `agent-preset/not-found` for a preset that is about to exist. Only that
 *    code is retried, with jittered backoff; an unusable preset (a different
 *    code) is reported immediately.
 *
 * Both waits are bounded by a deadline and cancellable through the plugin
 * instance's `AbortSignal`, so a replaced instance costs nothing.
 */

import { TIMING } from './constants.ts'
import {
  CODES,
  AgentModeError,
  isAbortError,
  isInactiveEffect,
  isPresetNotFound,
  presetFailureReason,
} from './errors.ts'
import { EXIT } from './constants.ts'
import { validatePresetId } from './args.ts'
import type { Reporter } from './log.ts'
import type { Clock, LoaderService, PresetService, PresetSummary } from './ports.ts'

/** What the selection helpers need. */
export interface SelectionDeps {
  readonly presets: PresetService
  readonly loader: LoaderService | undefined
  readonly clock: Clock
  readonly reporter: Reporter
  readonly signal?: AbortSignal | undefined
}

/** Count the preset declaration rows present in the composed tree. */
export function countDeclarations(
  loader: LoaderService | undefined,
  declarationName: string,
): number {
  if (loader === undefined) return 0
  let count = 0
  for (const entry of loader.entries()) {
    if (entry.options?.name === declarationName) count++
  }
  return count
}

/**
 * Race a promise against a bounded slice so no registry call can stall startup.
 *
 * Both branches get handlers before either may settle, so a losing branch can
 * never surface as an unhandled rejection. The work branch is attached first:
 * an already-settled registry call wins even when the clock resolves instantly.
 * @returns the work result, or `undefined` when the slice expired first.
 */
export function bounded<T>(
  promise: Promise<T>,
  ms: number,
  clock: Clock,
  signal?: AbortSignal,
): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    let settled = false
    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      action()
    }
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
    clock.sleep(ms, signal).then(
      () => finish(() => resolve(undefined)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

/** Sleep that aborts cleanly when the plugin instance is replaced. */
async function pause(clock: Clock, ms: number, signal?: AbortSignal): Promise<void> {
  await clock.sleep(ms, signal)
}

/**
 * Wait until the roster reports every declaration row, or the budget expires.
 * @returns the roster as observed; empty when nothing is declared.
 */
export async function waitForRoster(
  deps: SelectionDeps,
  expected: number,
  budgetMs: number = TIMING.rosterDeadlineMs,
): Promise<readonly PresetSummary[]> {
  const deadline = deps.clock.now() + budgetMs
  let delay: number = TIMING.pollStartMs
  for (;;) {
    const roster = await bounded(deps.presets.list(), TIMING.settleSliceMs, deps.clock, deps.signal)
    if (roster !== undefined && roster.length >= expected) return roster
    if (deps.clock.now() >= deadline) return roster ?? []
    await pause(deps.clock, delay, deps.signal)
    delay = Math.min(delay * 2, TIMING.pollMaxMs)
  }
}

/**
 * Resolve `wanted` (or the profile default) after letting the tree settle.
 * @throws {AgentModeError} `E_PRESET_UNKNOWN`, `E_PRESET_UNUSABLE`, or `E_REGISTRY`.
 */
export async function resolveSelection(
  deps: SelectionDeps,
  wanted: string | undefined,
  budgetMs: number = TIMING.resolveDeadlineMs,
): Promise<{ readonly id: string }> {
  const target = wanted ?? deps.presets.defaultId
  const invalid = wanted === undefined ? undefined : validatePresetId(wanted)
  if (invalid !== undefined) {
    throw new AgentModeError(CODES.usage, invalid, EXIT.usage)
  }
  const defaultInvalid = wanted === undefined ? validatePresetId(target) : undefined
  if (defaultInvalid !== undefined) {
    throw new AgentModeError(
      CODES.environment,
      `this profile's default agent preset "${target.slice(0, 64)}" is not a valid id; pass --agentmode <preset>`,
      EXIT.environment,
    )
  }

  const deadline = deps.clock.now() + budgetMs
  let delay: number = TIMING.pollStartMs
  for (;;) {
    if (deps.loader?.await !== undefined) {
      await bounded(deps.loader.await(), TIMING.settleSliceMs, deps.clock, deps.signal).catch(
        () => undefined,
      )
    }
    try {
      const preset = await bounded(
        deps.presets.resolve(target),
        TIMING.settleSliceMs,
        deps.clock,
        deps.signal,
      )
      if (preset === undefined) {
        if (deps.clock.now() >= deadline) break
        await pause(deps.clock, delay, deps.signal)
        delay = Math.min(delay * 2, TIMING.pollMaxMs)
        continue
      }
      return { id: preset.id }
    } catch (error) {
      // A disposed instance cancels its waits; that is not a preset problem.
      if (isAbortError(error) || isInactiveEffect(error)) throw error
      if (!isPresetNotFound(error)) {
        deps.reporter.warn(
          `preset "${target}" could not be resolved: ${presetFailureReason(error)}`,
        )
        throw new AgentModeError(
          CODES.presetUnusable,
          `agent preset "${target}" is not usable in this profile: ${presetFailureReason(error)}`,
          EXIT.preset,
          { cause: error },
        )
      }
      if (deps.clock.now() >= deadline) {
        const roster = await waitForRoster(deps, 0, TIMING.settleSliceMs).catch(
          () => [] as readonly PresetSummary[],
        )
        const available = roster.map((entry) => entry.id).join(', ')
        throw new AgentModeError(
          CODES.presetUnknown,
          `unknown agent preset "${target}"${available.length === 0 ? '' : `; available: ${available}`}`,
          EXIT.preset,
          { cause: error },
        )
      }
      await pause(deps.clock, delay, deps.signal)
      delay = Math.min(delay * 2, TIMING.pollMaxMs)
    }
  }

  throw new AgentModeError(
    CODES.registry,
    `the agent preset registry did not answer within ${Math.round(budgetMs / 1000)}s`,
    EXIT.preset,
  )
}
