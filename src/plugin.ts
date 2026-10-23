/**
 * The Cordis adapter: the only module that touches a real plugin context.
 *
 * Responsibilities, in startup order:
 *
 * 1. parse the app's flags (strictly, see `args.ts`);
 * 2. refuse to run in a composition that is not the ACP app (`assertAcpProfile`),
 *    so a bundle installed into the wrong profile fails loudly instead of
 *    hijacking another app's stdin and exit semantics;
 * 3. publish `acpAppStartup` **synchronously** — the App-level audit settles the
 *    loader tree on its own schedule, so readiness must not wait for registry
 *    I/O;
 * 4. resolve the requested preset in the background and bind it to each new
 *    session on the serial `agent/created` event;
 * 5. arm stdin EOF only after the selection resolved, so a rejected flag still
 *    exits nonzero, and release every timer through one `AbortController` when
 *    the instance is replaced.
 */

import { USAGE, parseArgs } from './args.ts'
import { EXIT, PLUGIN_NAME, ROW, SERVICE_STARTUP, TIMING } from './constants.ts'
import { composeAgent } from './compose.ts'
import {
  AgentModeError,
  CODES,
  environmentError,
  isAbortError,
  isDuplicateService,
  isInactiveEffect,
  toAgentModeError,
} from './errors.ts'
import { createReporter } from './log.ts'
import { countDeclarations, resolveSelection, waitForRoster } from './selection.ts'
import { describeSource, effectiveDefaultSource, rememberPreset } from './settings.ts'
import { oneLine } from './sanitize.ts'
import type { Reporter } from './log.ts'
import type {
  AgentRef,
  Clock,
  Launcher,
  LoaderService,
  PresetService,
  PresetSummary,
  ProjectionService,
  SettingsPort,
} from './ports.ts'
import { LIMITS } from './constants.ts'

/** Stable Cordis plugin name. */
export const name = PLUGIN_NAME

/** The launcher value that must exist before this app can parse its invocation. */
export const inject: readonly string[] = ['cmdlineArgs']

/** The Cordis context surface this plugin depends on (structural, no version lock). */
interface CordisContext extends Launcher {
  provide(service: string, value: unknown): void
  inject(dependencies: readonly string[], callback: (scoped: CordisContext) => void): void
  on(event: string, listener: (...args: readonly unknown[]) => unknown): () => void
  /** Register a disposer; `effect(() => () => {…})`, exactly the Cordis shape. */
  effect(create: () => () => void): void
  readonly agentPresets?: PresetService | undefined
  readonly sessionProjections?: ProjectionService | undefined
}

/** A clock whose pending sleeps are cleared when the instance is disposed. */
interface InstanceClock {
  readonly clock: Clock
  readonly dispose: () => void
}

/** Rejections caused by a replaced instance are expected, not failures. */
function isQuietError(error: unknown): boolean {
  return isInactiveEffect(error) || isAbortError(error)
}

/** Request process shutdown through the launcher (never `process.exit`). */
function requestExit(ctx: CordisContext, code: number): void {
  const exit = ctx.get('appExit')
  if (typeof exit === 'function') (exit as (code: number) => void)(code)
}

/** Write to stdout; the only two call sites are help and the roster. */
function emit(text: string): void {
  process.stdout.write(text)
}

/** Home directories whose absolute paths must not reach a diagnostic. */
function redactionMarkers(): readonly string[] {
  const markers = [process.env.HOME, process.env.DSH_HOME, process.env.DSH_PROFILE_DIR]
  return markers.filter(
    (marker): marker is string => typeof marker === 'string' && marker.length > 1,
  )
}

/** Path prefixes redacted from diagnostics. */
const markers = redactionMarkers()

/** Clock with disposal, so no timer outlives the instance. */
export function createInstanceClock(signal: AbortSignal): InstanceClock {
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const clock: Clock = {
    now: () => Date.now(),
    sleep(ms, abort) {
      return new Promise<void>((resolve, reject) => {
        if (abort?.aborted === true) {
          reject(abort.reason as unknown)
          return
        }
        const active = abort ?? signal
        const onAbort = (): void => {
          clearTimeout(timer)
          timers.delete(timer)
          active.removeEventListener('abort', onAbort)
          reject(active.reason as unknown)
        }
        const timer = setTimeout(() => {
          timers.delete(timer)
          active.removeEventListener('abort', onAbort)
          resolve()
        }, ms)
        timers.add(timer)
        active.addEventListener('abort', onAbort, { once: true })
      })
    },
  }
  return {
    clock,
    dispose() {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    },
  }
}

/**
 * Verify the composed tree is the ACP app with this bundle's patch applied.
 * @throws {AgentModeError} `E_ENVIRONMENT` when the composition is not the ACP app.
 */
export function assertAcpProfile(ctx: CordisContext, reporter: Reporter): void {
  const loader = ctx.get('loader') as LoaderService | undefined
  if (loader === undefined) {
    reporter.warn('cannot inspect the composed profile; the ACP app guard was skipped')
    return
  }
  let hasAcpApp = false
  let shippedStartupActive = false
  for (const entry of loader.entries()) {
    const entryName = entry.options?.name
    if (entryName === ROW.acpApp) hasAcpApp = true
    if (entryName === ROW.shippedStartup) shippedStartupActive = entry.options?.disabled !== true
  }
  if (!hasAcpApp) {
    throw environmentError(
      'this bundle belongs to the ACP profile but the profile composes no @deepseek-ai/dsh-acp row',
    )
  }
  if (shippedStartupActive) {
    throw environmentError(
      'the shipped zero-option startup provider is still active; disable the acp-app-startup row before using --agentmode',
    )
  }
}

/**
 * Publish the readiness service exactly once.
 * @returns whether this instance owns the service.
 */
export function publishStartup(
  ctx: CordisContext,
  value: Record<string, unknown>,
  reporter: Reporter,
): boolean {
  try {
    ctx.provide(SERVICE_STARTUP, value)
    return true
  } catch (error) {
    if (isQuietError(error)) return false
    if (isDuplicateService(error)) {
      reporter.warn('another row already published acpAppStartup; leaving it in charge')
      return false
    }
    throw error
  }
}

/** Extract an Agent from an `agent/created` payload without trusting its shape. */
function readAgent(payload: unknown): AgentRef | undefined {
  if (payload === null || typeof payload !== 'object') return undefined
  const agent = (payload as { agent?: unknown }).agent
  if (agent === null || typeof agent !== 'object') return undefined
  const record = agent as { id?: unknown; ctx?: unknown; session?: unknown }
  if (
    typeof record.id !== 'string' ||
    record.session === null ||
    typeof record.session !== 'object'
  ) {
    return undefined
  }
  if (record.ctx === null || typeof record.ctx !== 'object') return undefined
  return { id: record.id, ctx: record.ctx, session: record.session }
}

/** Format the roster for `--list-agentmodes` (stdout, bounded). */
export function formatRoster(
  roster: readonly PresetSummary[],
  defaultId: string,
  source: 'user' | 'override' | 'deployment' | 'unknown' = 'unknown',
): string {
  if (roster.length === 0) return 'No agent presets are declared in this profile.\n'
  const width = Math.max(...roster.map((entry) => entry.id.length))
  const lines = roster.map((entry) => {
    const mark =
      entry.id === defaultId ? (source === 'user' ? ' (default, user setting)' : ' (default)') : ''
    const problem =
      entry.broken === undefined || entry.broken === ''
        ? ''
        : `  [unusable: ${oneLine(entry.broken, LIMITS.rosterLine)}]`
    return `  ${entry.id.padEnd(width)}${mark}${problem}\n`
  })
  return lines.join('')
}

/** Bind stdin EOF to shutdown once the app is ready. */
function armEndOfInput(ctx: CordisContext, reporter: Reporter): void {
  const readyService = ctx.get('appReady')
  const stdin = process.stdin
  let armed = true
  const onEnd = (): void => {
    if (!armed) return
    armed = false
    const onReady = (readyService as { onReady?: (callback: () => void) => void } | undefined)
      ?.onReady
    if (typeof onReady === 'function') onReady(() => requestExit(ctx, 0))
    else requestExit(ctx, 0)
  }
  if (stdin.readableEnded) {
    onEnd()
  } else {
    stdin.once('end', onEnd)
  }
  ctx.effect(() => () => {
    armed = false
    stdin.off('end', onEnd)
  })
  reporter.info('waiting for the ACP client on stdio')
}

/**
 * The plugin entry point.
 * @param ctx - the Cordis plugin context.
 */
export function apply(ctx: CordisContext): void {
  const reporter = createReporter({
    stream: process.stderr,
    debug: process.env.DSH_ACP_AGENTMODE_DEBUG === '1',
    markers,
  })

  const command = parseArgs(ctx.cmdlineArgs?.get() ?? [])
  if (command.kind === 'help') {
    emit(USAGE)
    requestExit(ctx, 0)
    return
  }
  if (command.kind === 'invalid') {
    const failure = new AgentModeError(CODES.usage, command.message, EXIT.usage)
    reporter.failure(failure)
    requestExit(ctx, failure.exitCode)
    return
  }

  try {
    assertAcpProfile(ctx, reporter)
  } catch (error) {
    const failure = toAgentModeError(error, { code: CODES.environment, exitCode: EXIT.environment })
    reporter.failure(failure)
    requestExit(ctx, failure.exitCode)
    return
  }

  const controller = new AbortController()
  const instanceClock = createInstanceClock(controller.signal)
  ctx.effect(() => () => {
    controller.abort(new Error('plugin instance disposed'))
    instanceClock.dispose()
  })

  if (
    !publishStartup(
      ctx,
      { accepted: true, agentPreset: command.kind === 'serve' ? (command.preset ?? null) : null },
      reporter,
    )
  ) {
    return
  }

  // A registry that never activates would otherwise leave the app serving
  // sessions that can never be composed; fail loudly instead. The timer goes
  // through the instance clock, so disposal cancels it.
  let registryActivated = false
  void instanceClock.clock
    .sleep(TIMING.rosterDeadlineMs + TIMING.settleSliceMs)
    .then(() => {
      if (registryActivated) return
      const failure = environmentError('the agent preset registry never activated in this profile')
      reporter.failure(failure)
      requestExit(ctx, failure.exitCode)
    })
    .catch(() => undefined)

  ctx.inject(['agentPresets', 'sessionProjections'], (scoped) => {
    registryActivated = true
    const presets = scoped.agentPresets
    const projections = scoped.sessionProjections
    if (presets === undefined || projections === undefined) {
      const failure = environmentError(
        'agentPresets/sessionProjections are not available in this profile',
      )
      reporter.failure(failure)
      requestExit(ctx, failure.exitCode)
      return
    }

    const deps = {
      presets,
      loader: scoped.get('loader') as LoaderService | undefined,
      clock: instanceClock.clock,
      reporter,
      signal: controller.signal,
      settings: ctx.get('settings') as SettingsPort | undefined,
    }

    if (command.kind === 'list') {
      void runList(ctx, deps, reporter)
      return
    }

    const selection = resolveSelection(deps, command.preset).catch((error: unknown) => {
      throw toAgentModeError(error, { code: CODES.registry, exitCode: EXIT.preset })
    })

    selection.then(
      (resolved) => {
        void activate(ctx, deps, command, resolved, reporter).catch((error: unknown) => {
          if (isQuietError(error)) return
          const failure = toAgentModeError(error, {
            code: CODES.settings,
            exitCode: EXIT.environment,
          })
          reporter.failure(failure)
          requestExit(ctx, failure.exitCode)
        })
      },
      (error: unknown) => {
        if (isQuietError(error)) return
        const failure = toAgentModeError(error, { code: CODES.registry, exitCode: EXIT.preset })
        reporter.failure(failure)
        requestExit(ctx, failure.exitCode)
      },
    )

    scoped.on('agent/created', (payload: unknown) =>
      selection.then(async (resolved) => {
        const agent = readAgent(payload)
        if (agent === undefined) {
          reporter.warn('agent/created carried no usable Agent; skipping preset composition')
          return
        }
        await composeAgent({ presets, projections, reporter }, agent, resolved)
      }),
    )
  })
}

/**
 * Announce the selection, optionally persist it, then arm stdin EOF.
 *
 * Persistence failure is fatal on purpose: the operator asked for the choice to
 * be remembered, and a run that serves anyway would silently drop that request.
 * @param ctx - plugin context (for the launcher's exit path).
 * @param deps - registry, settings, clock, reporter, and cancellation.
 * @param command - the parsed invocation.
 * @param selection - the resolved preset.
 * @param reporter - diagnostic sink.
 */
async function activate(
  ctx: CordisContext,
  deps: {
    presets: PresetService
    settings: SettingsPort | undefined
    clock: Clock
    reporter: Reporter
    signal: AbortSignal
  },
  command: { readonly preset: string | undefined; readonly remember: boolean },
  selection: { readonly id: string },
  reporter: Reporter,
): Promise<void> {
  if (command.remember) {
    await rememberPreset(deps.settings, selection.id)
    reporter.info(`remembered agent preset: ${selection.id}`)
  }
  const source =
    command.preset === undefined
      ? describeSource(effectiveDefaultSource(deps.settings))
      : 'from --agentmode'
  reporter.info(`agent preset: ${selection.id} (${source})`)
  armEndOfInput(ctx, reporter)
}

/** `--list-agentmodes`: read the roster, print it, exit 0. */
async function runList(
  ctx: CordisContext,
  deps: {
    presets: PresetService
    loader: LoaderService | undefined
    clock: Clock
    reporter: Reporter
    signal: AbortSignal
  },
  reporter: Reporter,
): Promise<void> {
  try {
    const expected = countDeclarations(deps.loader, ROW.declaration)
    const roster = await waitForRoster(deps, expected)
    const settings = ctx.get('settings') as SettingsPort | undefined
    emit(formatRoster(roster, deps.presets.defaultId, effectiveDefaultSource(settings)))
    requestExit(ctx, 0)
  } catch (error) {
    if (isQuietError(error)) return
    const failure = toAgentModeError(error, { code: CODES.registry, exitCode: EXIT.preset })
    reporter.failure(failure)
    requestExit(ctx, failure.exitCode)
  }
}
