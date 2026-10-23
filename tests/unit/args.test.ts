import { describe, expect, it } from 'vitest'
import { parseArgs, validatePresetId } from '../../src/args.ts'

describe('parseArgs', () => {
  it('serves with no flags', () => {
    expect(parseArgs([])).toEqual({ kind: 'serve', preset: undefined, remember: false })
  })

  it('accepts --agentmode <id>', () => {
    expect(parseArgs(['--agentmode', 'cordis'])).toEqual({
      kind: 'serve',
      preset: 'cordis',
      remember: false,
    })
  })

  it('accepts --agentmode=<id>', () => {
    expect(parseArgs(['--agentmode=minimal'])).toEqual({
      kind: 'serve',
      preset: 'minimal',
      remember: false,
    })
  })

  it('accepts ids from the documented alphabet', () => {
    expect(parseArgs(['--agentmode', 'a.b_c-1'])).toEqual({
      kind: 'serve',
      preset: 'a.b_c-1',
      remember: false,
    })
  })

  it.each(['-h', '--help'])('reports help for %s', (flag) => {
    expect(parseArgs([flag])).toEqual({ kind: 'help' })
  })

  it('reports the listing request', () => {
    expect(parseArgs(['--list-agentmodes'])).toEqual({ kind: 'list' })
  })

  it('lets the listing win over a selection', () => {
    expect(parseArgs(['--agentmode', 'standard', '--list-agentmodes'])).toEqual({ kind: 'list' })
  })

  it('rejects unknown options instead of ignoring them', () => {
    expect(parseArgs(['--bogus'])).toEqual({
      kind: 'invalid',
      message: 'unknown option "--bogus"',
    })
  })

  it('rejects a missing value', () => {
    expect(parseArgs(['--agentmode'])).toEqual({
      kind: 'invalid',
      message: 'option "--agentmode <preset>" argument missing',
    })
  })

  it('rejects a value that looks like a flag', () => {
    expect(parseArgs(['--agentmode', '--list-agentmodes'])).toEqual({
      kind: 'invalid',
      message: 'option "--agentmode <preset>" argument missing',
    })
  })

  it('rejects an empty inline value', () => {
    expect(parseArgs(['--agentmode='])).toMatchObject({ kind: 'invalid' })
  })

  it('rejects repeated flags instead of last-wins', () => {
    expect(parseArgs(['--agentmode', 'a', '--agentmode', 'b'])).toEqual({
      kind: 'invalid',
      message: 'option "--agentmode" specified more than once',
    })
    expect(parseArgs(['--list-agentmodes', '--list-agentmodes'])).toEqual({
      kind: 'invalid',
      message: 'option "--list-agentmodes" specified more than once',
    })
  })

  it('rejects whitespace, control characters and leading separators', () => {
    expect(parseArgs(['--agentmode', 'a b'])).toMatchObject({ kind: 'invalid' })
    expect(parseArgs(['--agentmode', 'a\nb'])).toMatchObject({ kind: 'invalid' })
    expect(parseArgs(['--agentmode', '-standard'])).toMatchObject({ kind: 'invalid' })
    expect(parseArgs(['--agentmode', '.hidden'])).toMatchObject({ kind: 'invalid' })
  })

  it('rejects oversized ids', () => {
    const result = parseArgs(['--agentmode', 'a'.repeat(65)])
    expect(result).toMatchObject({ kind: 'invalid' })
  })

  it('accepts --remember together with a selection', () => {
    expect(parseArgs(['--agentmode', 'ptc', '--remember'])).toEqual({
      kind: 'serve',
      preset: 'ptc',
      remember: true,
    })
  })

  it('rejects --remember without a selection, or with the listing', () => {
    expect(parseArgs(['--remember'])).toEqual({
      kind: 'invalid',
      message: 'option "--remember" requires "--agentmode <preset>"',
    })
    expect(parseArgs(['--list-agentmodes', '--remember'])).toEqual({
      kind: 'invalid',
      message: 'option "--remember" requires "--agentmode <preset>"',
    })
    expect(parseArgs(['--remember', '--remember', '--agentmode', 'ptc'])).toEqual({
      kind: 'invalid',
      message: 'option "--remember" specified more than once',
    })
  })

  it('rejects positionals, including after a terminator', () => {
    expect(parseArgs(['extra'])).toEqual({
      kind: 'invalid',
      message: 'unknown option "extra"',
    })
    expect(parseArgs(['--', 'extra'])).toEqual({
      kind: 'invalid',
      message: 'unexpected argument "extra"; this app takes no positional arguments',
    })
    expect(parseArgs(['--'])).toMatchObject({ kind: 'invalid' })
  })
})

describe('validatePresetId', () => {
  it('accepts a conservative identifier', () => {
    expect(validatePresetId('standard')).toBeUndefined()
  })

  it('reports the first violated rule', () => {
    expect(validatePresetId('')).toContain('must not be empty')
    expect(validatePresetId('a'.repeat(65))).toContain('at most')
    expect(validatePresetId('-x')).toContain('may only contain')
  })
})
