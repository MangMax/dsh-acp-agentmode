/**
 * Diagnostic hygiene.
 *
 * Error text arrives from the harness, from Node, and from third-party plugins
 * inside preset compositions. It is untrusted: it may contain ANSI escape
 * sequences (terminal hijacking), newlines (log forging), or absolute paths
 * that leak the operator's directory layout. Everything written to stderr goes
 * through this module first.
 */

import { LIMITS } from './constants.ts'

/** CSI/OSC style escape sequences. */
// oxlint-disable-next-line no-control-regex -- stripping escapes is this module's job
const ANSI = /\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g

/** C0/C1 control characters other than tab (collapsed to a space below). */
// oxlint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g

/** Filesystem paths that should never appear verbatim in a diagnostic. */
const PATHY = /(?:file:\/\/)?\/(?:[^\s/:'"()[\]]+\/)+[^\s/:'"()[\]]+/g

/**
 * Collapse arbitrary text to one bounded, escape-free line.
 * @param input - untrusted text.
 * @param limit - maximum characters retained (ellipsis included).
 * @returns a printable single line.
 */
export function oneLine(input: string, limit: number = LIMITS.diagnostic): string {
  const flat = input
    .replace(ANSI, '')
    .replace(CONTROL, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (flat.length <= limit) return flat
  return `${flat.slice(0, Math.max(0, limit - 1))}…`
}

/**
 * Replace absolute paths with a stable placeholder.
 *
 * A diagnostic needs to say *which* file failed, not where the operator's home
 * directory is; `<path>` keeps the signal and drops the leak.
 * @param input - text already flattened by {@link oneLine}.
 * @param markers - path prefixes to erase first (e.g. home directories).
 * @returns text with paths replaced.
 */
export function redactPaths(input: string, markers: readonly string[] = []): string {
  let output = input
  for (const marker of markers) {
    if (marker.length < 2) continue
    output = output.split(marker).join('~')
  }
  return output.replace(PATHY, (match, offset: number, whole: string) =>
    whole[offset - 1] === '~' ? match : '<path>',
  )
}

/**
 * Describe an unknown thrown value, walking a bounded `cause` chain.
 * @param error - anything thrown.
 * @param limit - maximum characters of the joined description.
 * @returns a single-line, human-readable description.
 */
export function describeError(error: unknown, limit: number = LIMITS.diagnostic): string {
  const parts: string[] = []
  let current: unknown = error
  for (
    let depth = 0;
    depth <= LIMITS.causeDepth && current !== undefined && current !== null;
    depth++
  ) {
    const text = textOf(current)
    if (text !== undefined && text.length > 0 && !parts.includes(text)) parts.push(text)
    current = causeOf(current)
  }
  const joined = parts.length === 0 ? 'unknown error' : parts.join(' <- ')
  return oneLine(joined, limit)
}

/** Render one value of the cause chain. */
function textOf(value: unknown): string | undefined {
  if (value instanceof Error) {
    const record = value as unknown as { code?: unknown }
    const code = typeof record.code === 'string' ? record.code : undefined
    const name = value.name === '' ? 'Error' : value.name
    const message = value.message === '' ? undefined : value.message
    if (code !== undefined && message !== undefined) return `${name} [${code}]: ${message}`
    return message === undefined ? name : `${name}: ${message}`
  }
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

/** Read `cause` without trusting the value's shape. */
function causeOf(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return undefined
  return (value as { cause?: unknown }).cause
}

/** Stack trace, sanitized and bounded; only emitted in debug mode. */
export function describeStack(error: unknown): string {
  if (!(error instanceof Error) || typeof error.stack !== 'string') return ''
  return oneLine(error.stack, LIMITS.diagnostic * 2)
}
