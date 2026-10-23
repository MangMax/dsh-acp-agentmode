#!/usr/bin/env node
/**
 * End-to-end smoke test against a *real* installed harness.
 *
 * It drives the public ACP surface exactly like an editor would — `initialize`
 * then `session/new` — and proves the composition actually happened by reading
 * the session log the harness wrote: `agentPresets.select` appends
 * `agent-preset/selected` only after the preset mounted, so that event is the
 * end-to-end witness (and it needs no model call).
 *
 * Usage:
 *   node scripts/smoke-acp.ts                       # default preset
 *   node scripts/smoke-acp.ts --agentmode minimal   # explicit preset
 *
 * Environment:
 *   DSH_PROFILE_UNDER_TEST  profile to boot (default: acp)
 *   DSH_HOME                harness home (default: ~/.dsh)
 *
 * Exit codes: 0 pass, 1 assertion failure, 2 the harness could not be driven.
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

interface Options {
  readonly profile: string
  readonly preset: string | undefined
  readonly expected: string
  readonly home: string
  readonly cwd: string
}

interface Session {
  readonly sessionId: string
  readonly stdout: string
  readonly stderr: string
}

const TIMEOUT_MS = 120_000

function readOptions(argv: readonly string[]): Options {
  let preset: string | undefined
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--agentmode') {
      preset = argv[index + 1]
      index++
    } else if (arg?.startsWith('--agentmode=') === true) {
      preset = arg.slice('--agentmode='.length)
    }
  }
  return {
    profile: process.env.DSH_PROFILE_UNDER_TEST ?? 'acp',
    preset,
    expected: preset ?? 'standard',
    home: process.env.DSH_HOME ?? join(homedir(), '.dsh'),
    cwd: process.cwd(),
  }
}

function fail(message: string, code = 1): never {
  process.stderr.write(`smoke: ${message}\n`)
  process.exit(code)
}

/** Locate the session log directory for one session id. */
function sessionLog(home: string, sessionId: string): string | undefined {
  const root = join(home, 'sessions')
  if (!existsSync(root)) return undefined
  for (const workspace of readdirSync(root)) {
    const candidate = join(root, workspace, sessionId, 'session.v4.jsonl.zstd')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** Read the recorded preset out of a compressed session log. */
function recordedPreset(path: string): string | undefined {
  const text = zstdDecompressSync(readFileSync(path)).toString('utf8')
  for (const line of text.split('\n')) {
    if (!line.includes('agent-preset/selected')) continue
    try {
      const event = JSON.parse(line) as { data?: { agentPreset?: unknown } }
      if (typeof event.data?.agentPreset === 'string') return event.data.agentPreset
    } catch {
      // unparseable lines are caught by the assertion below, not here
    }
  }
  return undefined
}

/** Drive one ACP session over stdio and return what the app said. */
async function runSession(options: Options): Promise<Session> {
  const args = ['--profile', options.profile]
  if (options.preset !== undefined) args.push('--agentmode', options.preset)
  const child = spawn('dsh', args, { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'] })

  let stdout = ''
  let stderr = ''
  let sessionId: string | undefined
  let closed = false

  const closeInput = (): void => {
    if (closed) return
    closed = true
    child.stdin.end()
  }
  const send = (message: unknown): void => {
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  child.stdout.setEncoding('utf8')
  let buffer = ''
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
    buffer += chunk
    let index: number
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line === '') continue
      let message: { id?: number; result?: { sessionId?: string } }
      try {
        message = JSON.parse(line) as typeof message
      } catch {
        fail(`non-protocol stdout: ${line.slice(0, 200)}`, 2)
      }
      if (message.id === 1) {
        send({
          jsonrpc: '2.0',
          id: 2,
          method: 'session/new',
          params: { cwd: options.cwd, mcpServers: [] },
        })
      } else if (message.id === 2) {
        sessionId = message.result?.sessionId
        closeInput()
      }
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })

  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: 1, clientCapabilities: {} },
  })

  const exitCode = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve(null)
    }, TIMEOUT_MS)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
  if (exitCode === null) fail('the harness did not exit within the timeout', 2)
  if (sessionId === undefined) fail(`the harness produced no session\n${stderr.slice(-800)}`, 2)
  return { sessionId, stdout, stderr }
}

async function main(): Promise<number> {
  const options = readOptions(process.argv.slice(2))
  process.stdout.write(
    `smoke: profile=${options.profile} expectedPreset=${options.expected} home=${options.home}\n`,
  )

  const session = await runSession(options)

  const log = sessionLog(options.home, session.sessionId)
  if (log === undefined) fail(`no session log found for ${session.sessionId}`, 1)

  const preset = recordedPreset(log)
  if (preset === undefined) {
    fail('the session log records no agent-preset/selected event: the preset never mounted', 1)
  }
  if (preset !== options.expected) {
    fail(`session ran preset "${preset}" but "${options.expected}" was requested`, 1)
  }
  if (session.stdout.includes('error:') || session.stdout.includes('E_')) {
    fail('the app wrote diagnostics to stdout, which belongs to the ACP peer', 1)
  }

  process.stdout.write(
    `smoke: ok — session ${session.sessionId} ran preset "${preset}" (log ${log})\n`,
  )
  return 0
}

if (process.argv[1] !== undefined) {
  void main().then(
    (code) => {
      process.exitCode = code
    },
    (error: unknown) => {
      fail(error instanceof Error ? error.message : String(error), 2)
    },
  )
}
