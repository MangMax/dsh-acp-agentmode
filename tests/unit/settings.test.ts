import { describe, expect, it } from 'vitest'
import { CODES } from '../../src/errors.ts'
import { describeSource, effectiveDefaultSource, rememberPreset } from '../../src/settings.ts'
import type { SettingsPort } from '../../src/ports.ts'
import { fakeSettings } from '../helpers/fakes.ts'

describe('effectiveDefaultSource', () => {
  it('is unknown without a settings service', () => {
    expect(effectiveDefaultSource(undefined)).toBe('unknown')
  })

  it('is the deployment default when the profile overrides nothing', () => {
    expect(effectiveDefaultSource(fakeSettings({ user: {} }))).toBe('deployment')
  })

  it('is the user setting when the profile patch carries selectedDefault', () => {
    expect(effectiveDefaultSource(fakeSettings({ user: { selectedDefault: 'ptc' } }))).toBe('user')
  })

  it('reports a home patch or command-line override', () => {
    const settings: SettingsPort = {
      describe: () => [
        {
          ns: 'agent-preset-registry',
          user: {},
          value: { default: 'standard', selectedDefault: 'minimal' },
        },
      ],
      update: () => Promise.resolve(),
    }
    expect(effectiveDefaultSource(settings)).toBe('override')
  })

  it('survives a settings service that throws', () => {
    const broken: SettingsPort = {
      describe: () => {
        throw new Error('boom')
      },
      update: () => Promise.resolve(),
    }
    expect(effectiveDefaultSource(broken)).toBe('unknown')
  })
})

describe('describeSource', () => {
  it('renders each source', () => {
    expect(describeSource('user')).toBe('user setting')
    expect(describeSource('override')).toBe('home/command-line override')
    expect(describeSource('deployment')).toBe('deployment default')
    expect(describeSource('unknown')).toBe('source unknown')
  })
})

describe('rememberPreset', () => {
  it('writes the volatile field through the settings API', async () => {
    const settings = fakeSettings()
    await rememberPreset(settings, 'ptc')
    expect(settings.updates).toEqual([
      { ns: 'agent-preset-registry', patch: { selectedDefault: 'ptc' } },
    ])
  })

  it('refuses loudly when the profile has no settings service', async () => {
    await expect(rememberPreset(undefined, 'ptc')).rejects.toMatchObject({ code: CODES.settings })
  })

  it('surfaces a refused write, including the reason', async () => {
    const settings = fakeSettings({ updateError: new Error('a home patch takes precedence') })
    await expect(rememberPreset(settings, 'ptc')).rejects.toMatchObject({
      code: CODES.settings,
      message: expect.stringContaining('a home patch takes precedence'),
    })
  })
})
