/**
 * Structural ports.
 *
 * The plugin talks to four collaborators: the Launcher values Cordis provides,
 * the preset registry, the session projections, and the Loader tree. Each is
 * declared here as the narrowest shape the plugin actually uses, so:
 *
 * - this package keeps **no dependency** on a specific harness version or on
 *   `@deepseek-ai/cordis` types (version-coupling is an upgrade hazard), and
 * - every unit test can supply a hand-written fake without a live harness.
 *
 * These are *ports*: the adapters live in `plugin.ts` and are the only place
 * that touches the real Cordis context.
 */

/** One preset as the registry's roster reports it (activation failures included). */
export interface PresetSummary {
  readonly id: string
  /** Present when the declaration exists but cannot activate. */
  readonly broken?: string
}

/** A resolved preset identity. */
export interface PresetResolution {
  readonly id: string
  readonly broken?: string
}

/** The subset of a live Agent the plugin reads. */
export interface AgentRef {
  readonly id: string
  /** The Agent's scoped context; opaque to this plugin. */
  readonly ctx: object
  /** The Agent's session; opaque to this plugin. */
  readonly session: object
}

/** The `agentPresets` service (public contract of `dsh-agent-preset-registry`). */
export interface PresetService {
  readonly defaultId: string
  list(): Promise<readonly PresetSummary[]>
  resolve(id?: string): Promise<PresetResolution>
  select(agent: AgentRef, agentPreset: string): Promise<string>
  mount(ctx: object, agentPreset?: string): Promise<{ readonly id: string }>
  composedPreset(ctx: object): string | undefined
}

/** The `sessionProjections` service, reduced to the two keys this plugin reads. */
export interface ProjectionService {
  stateOf(session: object, key: string): unknown
}

/** One Loader row, as the plugin inspects the composed tree. */
export interface LoaderEntry {
  readonly options?:
    | {
        readonly id?: string | undefined
        readonly name?: string | undefined
        readonly disabled?: unknown
      }
    | undefined
}

/** The Loader service, reduced to enumeration and quiescence. */
export interface LoaderService {
  entries(): Iterable<LoaderEntry>
  /** Present on the real Loader; awaited (bounded) before a retry. */
  await?: (() => Promise<void>) | undefined
}

/** One settings form, reduced to the parts this plugin reads. */
export interface SettingsDescriptor {
  /** Profile entry id (the settings namespace). */
  readonly ns: string
  /** Values the active profile's patch layer overrides. */
  readonly user?: unknown
  /** Effective values after every layer. */
  readonly value?: unknown
}

/**
 * The `settings` service (public contract of `dsh-settings`).
 *
 * `describe()` reports each configurable entry's effective (`value`) and
 * user-overridden (`user`) form; `update(ns, patch)` merges volatile fields and
 * persists them through the **active profile's** Cordis patch — the same write
 * the Web settings UI performs.
 */
export interface SettingsPort {
  describe(): readonly SettingsDescriptor[]
  update(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<void>
}

/** The Launcher values a Cordis app plugin receives. */
export interface Launcher {
  readonly cmdlineArgs?: { get(): readonly string[] } | undefined
  get(name: string): unknown
}

/** A writable stream (stdout/stderr) — injectable so tests capture output. */
export interface WriteStream {
  write(chunk: string): unknown
}

/** Monotonic clock plus cancellable sleep, injected for testable timing. */
export interface Clock {
  now(): number
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}
