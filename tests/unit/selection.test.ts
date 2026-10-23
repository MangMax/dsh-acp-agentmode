import { describe, expect, it } from 'vitest'
import { AgentModeError, CODES } from '../../src/errors.ts'
import { bounded, countDeclarations, resolveSelection, waitForRoster } from '../../src/selection.ts'
import type { PresetSummary } from '../../src/ports.ts'
import {
  abortingClock,
  fakeClock,
  fakeLoader,
  fakePresets,
  fakeReporter,
} from '../helpers/fakes.ts'

/** A RemoteError-shaped rejection, as the registry raises them. */
function registryError(code: string, message: string, data?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code, ...(data === undefined ? {} : { data }) })
}

const ROSTER: readonly PresetSummary[] = [{ id: 'standard' }, { id: 'minimal' }]

function deps(overrides: Partial<Parameters<typeof resolveSelection>[0]> = {}) {
  return {
    presets: fakePresets({ roster: ROSTER }),
    loader: undefined,
    clock: fakeClock(),
    reporter: fakeReporter(),
    ...overrides,
  }
}

describe('countDeclarations', () => {
  it('counts rows by package name', () => {
    const loader = fakeLoader([
      { id: 'preset-standard', name: '@deepseek-ai/dsh-agent-preset' },
      { id: 'preset-minimal', name: '@deepseek-ai/dsh-agent-preset' },
      { id: 'agent', name: '@deepseek-ai/dsh-agent' },
    ])
    expect(countDeclarations(loader, '@deepseek-ai/dsh-agent-preset')).toBe(2)
  })

  it('is zero without a loader', () => {
    expect(countDeclarations(undefined, 'x')).toBe(0)
  })
})

describe('waitForRoster', () => {
  it('returns as soon as the expected declarations are visible', async () => {
    const roster = await waitForRoster(deps() as never, 2, 500)
    expect(roster.map((entry) => entry.id)).toEqual(['standard', 'minimal'])
  })

  it('gives up at the budget and returns what it has', async () => {
    const clock = fakeClock()
    const roster = await waitForRoster(deps({ clock }) as never, 5, 100)
    expect(roster).toHaveLength(2)
    expect(clock.elapsed()).toBeGreaterThanOrEqual(100)
  })
})

describe('bounded', () => {
  it('prefers work that is already settled', async () => {
    const value = await bounded(Promise.resolve('done'), 2_000, fakeClock())
    expect(value).toBe('done')
  })

  it('returns undefined when the slice expires', async () => {
    const value = await bounded(new Promise<string>(() => {}), 50, fakeClock())
    expect(value).toBeUndefined()
  })
})

describe('resolveSelection', () => {
  it('resolves the requested preset', async () => {
    const result = await resolveSelection(deps() as never, 'minimal')
    expect(result.id).toBe('minimal')
  })

  it('falls back to the profile default when no flag was given', async () => {
    const presets = fakePresets({ roster: ROSTER, defaultId: 'minimal' })
    const result = await resolveSelection(deps({ presets }) as never, undefined)
    expect(result.id).toBe('minimal')
    expect(presets.calls.resolve).toBe(1)
  })

  it('retries a not-found answer while the registry settles', async () => {
    const presets = fakePresets({
      roster: ROSTER,
      resolutions: [
        registryError('agent-preset/not-found', 'Unknown agent preset: minimal', {
          agentPreset: 'minimal',
        }),
        { id: 'minimal' },
      ],
    })
    const clock = fakeClock()
    const result = await resolveSelection(deps({ presets, clock }) as never, 'minimal')
    expect(result.id).toBe('minimal')
    expect(presets.calls.resolve).toBe(2)
  })

  it('reports an unknown preset with the available roster', async () => {
    const presets = fakePresets({
      roster: ROSTER,
      resolutions: [registryError('agent-preset/not-found', 'Unknown agent preset: nope')],
    })
    await expect(resolveSelection(deps({ presets }) as never, 'nope', 60)).rejects.toMatchObject({
      code: CODES.presetUnknown,
      message: expect.stringContaining('available: standard, minimal'),
    })
  })

  it('reports a declared-but-unusable preset with the registry reason', async () => {
    const presets = fakePresets({
      roster: ROSTER,
      resolutions: [
        registryError('agent-preset/invalid', 'not usable', {
          agentPreset: 'standard',
          reason: 'tool-cordis: waiting for cordisInspect',
        }),
      ],
    })
    await expect(resolveSelection(deps({ presets }) as never, 'standard')).rejects.toMatchObject({
      code: CODES.presetUnusable,
      message: expect.stringContaining('tool-cordis: waiting for cordisInspect'),
    })
  })

  it('rejects an invalid id before touching the registry', async () => {
    const presets = fakePresets({ roster: ROSTER })
    await expect(resolveSelection(deps({ presets }) as never, 'bad id')).rejects.toMatchObject({
      code: CODES.usage,
    })
    expect(presets.calls.resolve).toBe(0)
  })

  it('rejects an invalid profile default', async () => {
    const presets = fakePresets({ roster: ROSTER, defaultId: 'bad id' })
    await expect(resolveSelection(deps({ presets }) as never, undefined)).rejects.toMatchObject({
      code: CODES.environment,
    })
  })

  it('propagates cancellation instead of misreporting a preset problem', async () => {
    const presets = fakePresets({ roster: ROSTER })
    presets.resolve = () => new Promise(() => {})
    await expect(
      resolveSelection(deps({ presets, clock: abortingClock() }) as never, 'standard'),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('exposes AgentModeError for consumers that classify failures', async () => {
    const failure = new AgentModeError(CODES.usage, 'x', 2)
    expect(failure.code).toBe(CODES.usage)
    expect(failure.exitCode).toBe(2)
    expect(failure.name).toBe('AgentModeError')
  })
})
