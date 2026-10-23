#!/usr/bin/env node
/**
 * Regenerate `presets/*.patch.yml` from the shipped Web-surface preset
 * declarations, so this bundle's presets track the installed harness instead of
 * drifting from a stale hand copy.
 *
 * Usage:
 *   node scripts/sync-presets.ts [path-to-dsh-web-app-package]
 *
 * With no argument the script looks for `@deepseek-ai/dsh-web-app` under
 * `$DSH_HOME/profiles/node_modules` (the profile-resolved runtime package set)
 * and falls back to the `dsh` installation on PATH.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const PRESETS: readonly string[] = ['standard', 'ptc', 'minimal', 'cordis']

/**
 * Preset child rows whose Host dependency the automation-only ACP surface does
 * not mount, disabled in the snapshot rather than deleted so the difference
 * from upstream stays visible:
 *
 * - `tool-schedule` reads the `schedule` service, whose provider
 *   (`@deepseek-ai/dsh-schedule`) requires the Web-only `sessionController`;
 * - `tool-cordis` reads `cordisInspect`, which only the Web-only inspector
 *   (`webServer` + `connection`) provides.
 */
const UNSUPPORTED_CHILD_ROWS: ReadonlyMap<string, string> = new Map([
  ['tool-schedule', 'needs the Web-only schedule/sessionController rows'],
  ['tool-cordis', 'needs the Web-only inspector cordisInspect registry'],
])

/** Candidate locations of the installed Web-surface bundle. */
function candidates(): string[] {
  const found: string[] = []
  const home = process.env.DSH_HOME
  if (home !== undefined) {
    for (const profile of ['desktop', 'web', 'acp']) {
      found.push(join(home, 'profiles', profile, 'node_modules', '@deepseek-ai', 'dsh-web-app'))
    }
    found.push(join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-web-app'))
  }
  try {
    const bin = execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim()
    const require = createRequire(`${resolve(dirname(bin))}/`)
    found.push(dirname(require.resolve('@deepseek-ai/dsh-web-app/package.json')))
  } catch {
    // `dsh` may be absent outside a harness installation; the DSH_HOME probes stand.
  }
  return found
}

/**
 * Disable preset child rows this surface cannot host, keeping upstream content
 * intact otherwise.
 * @param body - one shipped preset patch file.
 * @returns the adapted patch text.
 */
export function adapt(body: string): string {
  const out: string[] = []
  for (const line of body.split('\n')) {
    out.push(line)
    const match = /^(\s*)- id: (\S+)$/.exec(line)
    if (match === null) continue
    const [, indent, id] = match
    if (id === undefined || indent === undefined) continue
    if (!UNSUPPORTED_CHILD_ROWS.has(id)) continue
    out.push(`${indent}  disabled: true`)
  }
  return out.join('\n')
}

/** Locate the Web app package directory. */
function resolveSource(argument: string | undefined): string | undefined {
  if (argument !== undefined) return argument
  return candidates().find((dir) => existsSync(join(dir, 'presets', 'standard.patch.yml')))
}

function main(): number {
  const source = resolveSource(process.argv[2])
  if (source === undefined) {
    process.stderr.write(
      'sync-presets: could not locate @deepseek-ai/dsh-web-app; pass its package directory as argv[2]\n',
    )
    return 1
  }

  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as {
    version?: string
  }
  const version = manifest.version ?? 'unknown'
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'presets')
  mkdirSync(outDir, { recursive: true })

  for (const id of PRESETS) {
    const from = join(source, 'presets', `${id}.patch.yml`)
    const header = [
      `# Snapshot of @deepseek-ai/dsh-web-app@${version} presets/${id}.patch.yml`,
      '# Regenerate with `pnpm sync-presets` after a harness upgrade;',
      '# do not hand-edit this file.',
      '',
    ].join('\n')
    writeFileSync(join(outDir, `${id}.patch.yml`), header + adapt(readFileSync(from, 'utf8')))
    process.stdout.write(`synced ${id} <- ${from}\n`)
  }
  return 0
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main()
}
