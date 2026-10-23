/**
 * Hand-written fakes for the ports. No live harness, no timers, no I/O.
 */

import type {
  AgentRef,
  Clock,
  Launcher,
  LoaderEntry,
  LoaderService,
  PresetService,
  PresetSummary,
  ProjectionService,
  SettingsPort,
  WriteStream,
} from '../../src/ports.ts'
import type { Reporter } from '../../src/log.ts'

/** A clock that advances by the requested delay and never touches real time. */
export function fakeClock(start = 1_000): Clock & { readonly elapsed: () => number } {
  let now = start
  return {
    now: () => now,
    elapsed: () => now - start,
    sleep: (ms) => {
      now += ms
      return Promise.resolve()
    },
  }
}

/** A clock whose sleeps reject immediately, emulating a disposed instance. */
export function abortingClock(): Clock {
  const reason = Object.assign(new Error('aborted'), { name: 'AbortError' })
  return {
    now: () => 0,
    sleep: () => Promise.reject(reason),
  }
}

/** Registry fake: a roster, a default, and scripted resolve outcomes. */
export interface FakePresetsOptions {
  readonly roster?: readonly PresetSummary[]
  readonly defaultId?: string
  /** Successive resolve outcomes; the last one repeats. */
  readonly resolutions?: ReadonlyArray<{ id: string } | Error>
}

export interface FakePresets extends PresetService {
  readonly selects: Array<{ agent: string; preset: string }>
  readonly mounts: Array<{ ctx: object; preset: string }>
  readonly calls: { list: number; resolve: number }
  setComposed(value: string | undefined): void
  setSelectError(error: unknown, times?: number): void
  setMountError(error: unknown): void
}

export function fakePresets(options: FakePresetsOptions = {}): FakePresets {
  const roster = options.roster ?? [{ id: 'standard' }, { id: 'minimal' }]
  const resolutions = options.resolutions ?? roster.map((entry) => ({ id: entry.id }))
  const calls = { list: 0, resolve: 0 }
  const selects: Array<{ agent: string; preset: string }> = []
  const mounts: Array<{ ctx: object; preset: string }> = []
  let composed: string | undefined
  let selectError: unknown
  let selectErrorTimes = 0
  let mountError: unknown
  return {
    get defaultId() {
      return options.defaultId ?? roster[0]?.id ?? 'standard'
    },
    calls,
    selects,
    mounts,
    setComposed: (value) => {
      composed = value
    },
    setSelectError: (error, times = Number.POSITIVE_INFINITY) => {
      selectError = error
      selectErrorTimes = times
    },
    setMountError: (error) => {
      mountError = error
    },
    list: () => {
      calls.list++
      return Promise.resolve(roster)
    },
    resolve: (id) => {
      calls.resolve++
      const wanted = id ?? options.defaultId ?? roster[0]?.id ?? 'standard'
      if (options.resolutions !== undefined) {
        const index = Math.min(calls.resolve - 1, resolutions.length - 1)
        const outcome = resolutions[index] ?? new Error('no resolution scripted')
        return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome)
      }
      const found = roster.find((entry) => entry.id === wanted)
      if (found === undefined) {
        return Promise.reject(
          presetNotFound(
            wanted,
            roster.map((entry) => entry.id),
          ),
        )
      }
      return Promise.resolve({ id: found.id })
    },
    select: (agent, preset) => {
      if (selectError !== undefined && selectErrorTimes > 0) {
        selectErrorTimes--
        return Promise.reject(selectError)
      }
      selects.push({ agent: agent.id, preset })
      return Promise.resolve(preset)
    },
    mount: (ctx, preset = '') => {
      if (mountError !== undefined) return Promise.reject(mountError)
      mounts.push({ ctx, preset })
      return Promise.resolve({ id: preset })
    },
    composedPreset: () => composed,
  }
}

/**
 * A registry-shaped "not found" rejection, matching the error the real
 * `agent-presets` registry raises.
 */
export function presetNotFound(id: string, available: readonly string[] = []): Error {
  return Object.assign(new Error(`Unknown agent preset: ${id}`), {
    code: 'agent-preset/not-found',
    data: { agentPreset: id, available: [...available] },
  })
}

/** Projection fake: a plain map keyed by agent id then projection key. */
export function fakeProjections(
  data: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {},
): ProjectionService {
  return {
    stateOf(session) {
      const id = (session as { id?: unknown }).id
      if (typeof id !== 'string') return undefined
      return data[id]?.['value']
    },
  }
}

/** Projection fake that reads the session's own `state` map (easier for tests). */
export function sessionStateProjections(): ProjectionService {
  return {
    stateOf(session, key) {
      return (session as { state?: Record<string, unknown> }).state?.[key]
    },
  }
}

/** Loader fake built from `[id, name, disabled]` triples. */
export function fakeLoader(
  rows: ReadonlyArray<{ id?: string; name: string; disabled?: unknown }>,
): LoaderService {
  const entries: LoaderEntry[] = rows.map((row) => ({
    options: {
      ...(row.id === undefined ? {} : { id: row.id }),
      name: row.name,
      disabled: row.disabled,
    },
  }))
  return {
    entries: () => entries,
    await: () => Promise.resolve(),
  }
}

/** Settings fake: one form for the registry namespace, recording writes. */
export interface FakeSettings extends SettingsPort {
  readonly updates: Array<{ ns: string; patch: Record<string, unknown> }>
}

export function fakeSettings(
  options: { user?: Record<string, unknown>; updateError?: unknown } = {},
): FakeSettings {
  const updates: Array<{ ns: string; patch: Record<string, unknown> }> = []
  return {
    updates,
    describe: () => [
      {
        ns: 'agent-preset-registry',
        user: options.user ?? {},
        value: { default: 'standard', ...options.user },
      },
    ],
    update: (ns, patch) => {
      if (options.updateError !== undefined) return Promise.reject(options.updateError)
      updates.push({ ns, patch })
      return Promise.resolve()
    },
  }
}

/** Reporter fake that records rendered lines. */
export interface FakeReporter extends Reporter {
  readonly lines: string[]
  readonly infos: string[]
  readonly warnings: string[]
  readonly failures: string[]
}

export function fakeReporter(): FakeReporter {
  const lines: string[] = []
  const infos: string[] = []
  const warnings: string[] = []
  const failures: string[] = []
  return {
    lines,
    infos,
    warnings,
    failures,
    info: (message) => {
      infos.push(message)
      lines.push(`info ${message}`)
    },
    warn: (message) => {
      warnings.push(message)
      lines.push(`warn ${message}`)
    },
    failure: (error) => {
      failures.push(`${error.code}: ${error.message}`)
      lines.push(`fail ${error.code}: ${error.message}`)
    },
  }
}

/** Collecting stderr/stdout stream. */
export function fakeStream(): WriteStream & { readonly text: () => string } {
  let buffer = ''
  return {
    write: (chunk: string) => {
      buffer += chunk
      return true
    },
    text: () => buffer,
  }
}

/** The Cordis context surface, faked for `apply()` tests. */
export interface FakeContextResult {
  readonly ctx: Launcher & {
    provide(service: string, value: unknown): void
    inject(
      dependencies: readonly string[],
      callback: (scoped: FakeContextResult['ctx']) => void,
    ): void
    on(event: string, listener: (...args: readonly unknown[]) => unknown): () => void
    effect(create: () => () => void): void
    readonly agentPresets?: PresetService
    readonly sessionProjections?: ProjectionService
  }
  readonly provided: Map<string, unknown>
  readonly listeners: Map<string, Array<(...args: readonly unknown[]) => unknown>>
  readonly exits: number[]
  disposeAll(): void
  emit(event: string, payload: unknown): Promise<unknown>
}

export interface FakeContextOptions {
  readonly argv?: readonly string[]
  readonly loader?: LoaderService
  readonly presets?: PresetService
  readonly projections?: ProjectionService
  /** Make `provide` reject, emulating a duplicate service registration. */
  readonly provideError?: unknown
  readonly ready?: boolean
  /** When false, the injected callback is never invoked. */
  readonly injectServices?: boolean
  /** The optional settings service. */
  readonly settings?: SettingsPort
}

export function fakeContext(options: FakeContextOptions = {}): FakeContextResult {
  const provided = new Map<string, unknown>()
  const listeners = new Map<string, Array<(...args: readonly unknown[]) => unknown>>()
  const exits: number[] = []
  const disposers: Array<() => void> = []
  const services = new Map<string, unknown>([
    ['loader', options.loader],
    ['appExit', (code: number) => exits.push(code)],
    ['appReady', { onReady: (callback: () => void) => callback() }],
    ['settings', options.settings],
  ])

  const ctx = {
    cmdlineArgs: { get: () => options.argv ?? [] },
    get: (name: string) => services.get(name),
    provide: (service: string, value: unknown) => {
      if (options.provideError !== undefined) throw options.provideError
      provided.set(service, value)
      services.set(service, value)
    },
    inject: (_dependencies: readonly string[], callback: (scoped: unknown) => void) => {
      if (options.injectServices === false) return
      if (options.presets === undefined || options.projections === undefined) return
      const mutable = ctx as unknown as Record<string, unknown>
      mutable['agentPresets'] = options.presets
      mutable['sessionProjections'] = options.projections
      callback(ctx)
    },
    on: (event: string, listener: (...args: readonly unknown[]) => unknown) => {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((candidate) => candidate !== listener),
        )
      }
    },
    effect: (create: () => () => void) => {
      disposers.push(create())
    },
  } as unknown as FakeContextResult['ctx']

  return {
    ctx,
    provided,
    listeners,
    exits,
    disposeAll: () => {
      for (const dispose of disposers) dispose()
    },
    emit: async (event: string, payload: unknown) => {
      const results: unknown[] = []
      for (const listener of listeners.get(event) ?? []) results.push(await listener(payload))
      return results[0]
    },
  }
}

/** Build an Agent whose session state feeds `sessionStateProjections()`. */
export function fakeAgent(id: string, state: Record<string, unknown> = {}): AgentRef {
  return { id, ctx: { scope: id }, session: { id, state } }
}
