import { describe, expect, it } from 'vitest'
import { composeAgent, isBlank, readRecordedPreset } from '../../src/compose.ts'
import { fakeAgent, fakePresets, fakeReporter, sessionStateProjections } from '../helpers/fakes.ts'

const selection = { id: 'standard' }

function deps(presets = fakePresets(), reporter = fakeReporter()) {
  return { presets, projections: sessionStateProjections(), reporter }
}

describe('readRecordedPreset', () => {
  it('accepts only non-empty strings', () => {
    expect(readRecordedPreset('minimal')).toBe('minimal')
    expect(readRecordedPreset('')).toBeUndefined()
    expect(readRecordedPreset(null)).toBeUndefined()
    expect(readRecordedPreset(42)).toBeUndefined()
  })
})

describe('isBlank', () => {
  it('treats a missing boundary as blank', () => {
    expect(isBlank(undefined)).toBe(true)
  })

  it('treats no-open-turn and no-completed-turn as blank', () => {
    expect(isBlank({ openTurnStartSeq: null, lastTurn: 0 })).toBe(true)
  })

  it('treats a started session as not blank', () => {
    expect(isBlank({ openTurnStartSeq: 3, lastTurn: 0 })).toBe(false)
    expect(isBlank({ openTurnStartSeq: null, lastTurn: 2 })).toBe(false)
  })

  it('treats an unknown shape as not blank, so `mount` is used', () => {
    expect(isBlank('weird')).toBe(false)
    expect(isBlank({})).toBe(false)
  })
})

describe('composeAgent', () => {
  it('does nothing when another composer already bound the Agent', async () => {
    const presets = fakePresets()
    presets.setComposed('minimal')
    await composeAgent(deps(presets), fakeAgent('s1'), selection)
    expect(presets.selects).toEqual([])
    expect(presets.mounts).toEqual([])
  })

  it('selects the requested preset on a new blank session', async () => {
    const presets = fakePresets()
    await composeAgent(deps(presets), fakeAgent('s1'), selection)
    expect(presets.selects).toEqual([{ agent: 's1', preset: 'standard' }])
    expect(presets.mounts).toEqual([])
  })

  it('prefers the preset a resumed session recorded', async () => {
    const presets = fakePresets()
    await composeAgent(deps(presets), fakeAgent('s2', { agentPreset: 'minimal' }), selection)
    expect(presets.selects).toEqual([{ agent: 's2', preset: 'minimal' }])
  })

  it('mounts instead of selecting once a session has started', async () => {
    const presets = fakePresets()
    await composeAgent(
      deps(presets),
      fakeAgent('s3', { turnBoundary: { openTurnStartSeq: null, lastTurn: 1 } }),
      selection,
    )
    expect(presets.selects).toEqual([])
    expect(presets.mounts).toEqual([{ ctx: { scope: 's3' }, preset: 'standard' }])
  })

  it('falls back to the requested preset when the recorded one cannot be bound', async () => {
    const reporter = fakeReporter()
    const presets = fakePresets()
    presets.setSelectError(new Error('agent-preset/locked'), 1)
    await composeAgent(
      deps(presets, reporter),
      fakeAgent('s4', { agentPreset: 'minimal' }),
      selection,
    )
    expect(reporter.warnings.some((line) => line.includes('fell back'))).toBe(true)
  })

  it('never throws when both bindings fail; it warns instead', async () => {
    const reporter = fakeReporter()
    const presets = fakePresets()
    presets.setSelectError(new Error('nope'))
    await expect(
      composeAgent(deps(presets, reporter), fakeAgent('s5'), selection),
    ).resolves.toBeUndefined()
    expect(
      reporter.warnings.some((line) => line.includes('runs without a preset composition')),
    ).toBe(true)
  })
})
