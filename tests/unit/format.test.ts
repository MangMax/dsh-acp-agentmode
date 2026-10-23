import { describe, expect, it } from 'vitest'
import { formatRoster } from '../../src/plugin.ts'

describe('formatRoster', () => {
  it('explains an empty roster', () => {
    expect(formatRoster([], 'standard')).toBe('No agent presets are declared in this profile.\n')
  })

  it('marks the default and pads the ids', () => {
    const text = formatRoster([{ id: 'standard' }, { id: 'ptc' }], 'standard')
    expect(text).toBe('  standard (default)\n  ptc     \n')
  })

  it('labels a user-set default', () => {
    expect(formatRoster([{ id: 'ptc' }], 'ptc', 'user')).toContain('(default, user setting)')
  })

  it('shows why a declared preset cannot be used', () => {
    const text = formatRoster(
      [{ id: 'cordis', broken: 'tool-cordis: waiting for cordisInspect' }],
      'cordis',
    )
    expect(text).toContain('[unusable: tool-cordis: waiting for cordisInspect]')
  })

  it('bounds and flattens hostile diagnostic text', () => {
    const text = formatRoster([{ id: 'x', broken: `${'y'.repeat(500)}\n\u001B[31m` }], 'x')
    expect(text.split('\n').length).toBeLessThanOrEqual(2)
    expect(text).not.toContain('\u001B')
  })
})
