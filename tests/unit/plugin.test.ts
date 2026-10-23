import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../../src/plugin.ts'
import {
  fakeAgent,
  fakeContext,
  fakeLoader,
  fakePresets,
  fakeSettings,
  sessionStateProjections,
} from '../helpers/fakes.ts'

const ACP_ROWS = [
  { id: 'acp-app-startup', name: '@deepseek-ai/dsh-acp-app', disabled: true },
  { id: 'acp', name: '@deepseek-ai/dsh-acp' },
  { id: 'acp-agentmode', name: 'dsh-acp-agentmode' },
]

const stdoutChunks: string[] = []
const stderrChunks: string[] = []

function capture(): void {
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdoutChunks.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderrChunks.push(String(chunk))
    return true
  })
}

function stdout(): string {
  return stdoutChunks.join('')
}

function stderr(): string {
  return stderrChunks.join('')
}

afterEach(() => {
  vi.restoreAllMocks()
  stdoutChunks.length = 0
  stderrChunks.length = 0
})

describe('apply', () => {
  it('prints help on stdout and exits 0', () => {
    capture()
    const fixture = fakeContext({ argv: ['-h'] })
    apply(fixture.ctx)
    expect(stdout()).toContain('Usage: dsh --profile acp')
    expect(fixture.exits).toEqual([0])
  })

  it('rejects an unknown flag with exit 2 and a classified code', () => {
    capture()
    const fixture = fakeContext({ argv: ['--bogus'] })
    apply(fixture.ctx)
    expect(fixture.exits).toEqual([2])
    expect(stderr()).toContain('E_USAGE')
    expect(fixture.provided.size).toBe(0)
  })

  it('refuses to run outside the ACP app', () => {
    capture()
    const fixture = fakeContext({
      argv: [],
      loader: fakeLoader([{ id: 'agent', name: '@deepseek-ai/dsh-agent' }]),
    })
    apply(fixture.ctx)
    expect(fixture.exits).toEqual([4])
    expect(stderr()).toContain('E_ENVIRONMENT')
    expect(fixture.provided.size).toBe(0)
  })

  it('refuses to run while the shipped startup provider is still active', () => {
    capture()
    const fixture = fakeContext({
      argv: [],
      loader: fakeLoader([
        { id: 'acp-app-startup', name: '@deepseek-ai/dsh-acp-app' },
        { id: 'acp', name: '@deepseek-ai/dsh-acp' },
      ]),
    })
    apply(fixture.ctx)
    expect(fixture.exits).toEqual([4])
    expect(stderr()).toContain('still active')
  })

  it('publishes readiness synchronously, before the registry work', () => {
    capture()
    const presets = fakePresets()
    const fixture = fakeContext({
      argv: ['--agentmode', 'minimal'],
      loader: fakeLoader(ACP_ROWS),
      presets,
      projections: sessionStateProjections(),
    })
    apply(fixture.ctx)
    expect(fixture.provided.get('acpAppStartup')).toMatchObject({
      accepted: true,
      agentPreset: 'minimal',
    })
    fixture.disposeAll()
  })

  it('binds the resolved preset to a new session', async () => {
    capture()
    const presets = fakePresets()
    const fixture = fakeContext({
      argv: ['--agentmode', 'minimal'],
      loader: fakeLoader(ACP_ROWS),
      presets,
      projections: sessionStateProjections(),
    })
    apply(fixture.ctx)
    await vi.waitFor(() => expect(presets.calls.resolve).toBeGreaterThan(0))
    await fixture.emit('agent/created', { agent: fakeAgent('session-1') })
    expect(presets.selects).toEqual([{ agent: 'session-1', preset: 'minimal' }])
    expect(stderr()).toContain('agent preset: minimal')
    fixture.disposeAll()
  })

  it('lists the roster on stdout and exits 0', async () => {
    capture()
    const presets = fakePresets()
    const fixture = fakeContext({
      argv: ['--list-agentmodes'],
      loader: fakeLoader(ACP_ROWS),
      presets,
      projections: sessionStateProjections(),
    })
    apply(fixture.ctx)
    await vi.waitFor(() => expect(stdout()).toContain('standard'))
    expect(stdout()).toContain('(default)')
    expect(fixture.exits).toContain(0)
    fixture.disposeAll()
  })

  it('reports the profile user setting as the default source', async () => {
    capture()
    const presets = fakePresets({ roster: [{ id: 'standard' }, { id: 'ptc' }], defaultId: 'ptc' })
    const fixture = fakeContext({
      argv: [],
      loader: fakeLoader(ACP_ROWS),
      presets,
      projections: sessionStateProjections(),
      settings: fakeSettings({ user: { selectedDefault: 'ptc' } }),
    })
    apply(fixture.ctx)
    await vi.waitFor(() => expect(stderr()).toContain('(user setting)'))
    expect(stderr()).toContain('agent preset: ptc')
    fixture.disposeAll()
  })

  it('reports the deployment default when the profile overrides nothing', async () => {
    capture()
    const fixture = fakeContext({
      argv: [],
      loader: fakeLoader(ACP_ROWS),
      presets: fakePresets(),
      projections: sessionStateProjections(),
      settings: fakeSettings(),
    })
    apply(fixture.ctx)
    await vi.waitFor(() => expect(stderr()).toContain('(deployment default)'))
    fixture.disposeAll()
  })

  it('persists the selection with --remember', async () => {
    capture()
    const settings = fakeSettings()
    const fixture = fakeContext({
      argv: ['--agentmode', 'minimal', '--remember'],
      loader: fakeLoader(ACP_ROWS),
      presets: fakePresets(),
      projections: sessionStateProjections(),
      settings,
    })
    apply(fixture.ctx)
    await vi.waitFor(() => expect(settings.updates).toHaveLength(1))
    expect(settings.updates[0]).toEqual({
      ns: 'agent-preset-registry',
      patch: { selectedDefault: 'minimal' },
    })
    expect(stderr()).toContain('remembered agent preset: minimal')
    expect(fixture.exits).not.toContain(4)
    fixture.disposeAll()
  })

  it('fails loudly when --remember cannot persist', async () => {
    capture()
    const fixture = fakeContext({
      argv: ['--agentmode', 'minimal', '--remember'],
      loader: fakeLoader(ACP_ROWS),
      presets: fakePresets(),
      projections: sessionStateProjections(),
      settings: fakeSettings({ updateError: new Error('a home patch takes precedence') }),
    })
    apply(fixture.ctx)
    await vi.waitFor(() => expect(fixture.exits).toContain(4))
    expect(stderr()).toContain('E_SETTINGS')
    expect(stderr()).toContain('a home patch takes precedence')
    fixture.disposeAll()
  })

  it('leaves a duplicate readiness provider in charge instead of crashing', () => {
    capture()
    const duplicate = Object.assign(
      new Error('service "acpAppStartup" has been registered at foo'),
      {},
    )
    const fixture = fakeContext({
      argv: [],
      loader: fakeLoader(ACP_ROWS),
      presets: fakePresets(),
      projections: sessionStateProjections(),
      provideError: duplicate,
    })
    expect(() => apply(fixture.ctx)).not.toThrow()
    expect(stderr()).toContain('leaving it in charge')
    expect(fixture.exits).toEqual([])
    fixture.disposeAll()
  })
})
