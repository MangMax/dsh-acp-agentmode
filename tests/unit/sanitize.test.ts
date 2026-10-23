import { describe, expect, it } from 'vitest'
import { describeError, describeStack, oneLine, redactPaths } from '../../src/sanitize.ts'

describe('oneLine', () => {
  it('strips ANSI escapes and control characters', () => {
    expect(oneLine('\u001B[31mred\u001B[0m')).toBe('red')
    expect(oneLine('a\u0000b\u0007c')).toBe('a b c')
  })

  it('collapses newlines and runs of whitespace', () => {
    expect(oneLine('line one\r\nline two\t\tend')).toBe('line one line two end')
  })

  it('bounds the result', () => {
    const value = oneLine('x'.repeat(500), 10)
    expect(value).toHaveLength(10)
    expect(value.endsWith('…')).toBe(true)
  })

  it('keeps short text untouched', () => {
    expect(oneLine('  hello  ')).toBe('hello')
  })
})

describe('redactPaths', () => {
  it('erases configured home directories', () => {
    expect(redactPaths('/home/operator/.dsh/profiles/acp/x.yml failed', ['/home/operator'])).toBe(
      '~/.dsh/profiles/acp/x.yml failed',
    )
  })

  it('replaces remaining absolute paths', () => {
    expect(redactPaths('cannot read /var/folders/tmp/abc.json')).toBe('cannot read <path>')
  })

  it('ignores unusably short markers', () => {
    expect(redactPaths('a/b', ['/'])).toBe('a/b')
  })
})

describe('describeError', () => {
  it('renders a code-bearing error', () => {
    const error = Object.assign(new Error('boom'), { code: 'E_X' })
    expect(describeError(error)).toBe('Error [E_X]: boom')
  })

  it('walks a bounded cause chain', () => {
    const root = new Error('root cause')
    const middle = new Error('middle', { cause: root })
    const top = new Error('top', { cause: middle })
    expect(describeError(top)).toBe('Error: top <- Error: middle <- Error: root cause')
  })

  it('never throws on hostile thrown values', () => {
    expect(describeError(undefined)).toBe('unknown error')
    expect(describeError(42)).toBe('42')
    expect(describeError({ nope: true })).toBe('unknown error')
    const cyclic: Record<string, unknown> = {}
    cyclic['cause'] = cyclic
    expect(() => describeError(cyclic)).not.toThrow()
  })

  it('flattens multi-line messages', () => {
    expect(describeError(new Error('a\nb'))).toBe('Error: a b')
  })
})

describe('describeStack', () => {
  it('is empty for non-errors', () => {
    expect(describeStack('nope')).toBe('')
  })

  it('is flattened for errors', () => {
    const error = new Error('x')
    expect(describeStack(error)).not.toContain('\n')
  })
})
