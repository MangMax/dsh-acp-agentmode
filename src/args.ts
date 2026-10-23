/**
 * The app's flag family, parsed strictly and without a dependency.
 *
 * The shipped ACP startup provider rejects every option, so this parser defines
 * the whole surface. It is deliberately conservative:
 *
 * - unknown options fail instead of being ignored (a typo must not silently run
 *   the default preset);
 * - `--` does not smuggle positionals: this app accepts none;
 * - a preset id is validated against a narrow grammar *before* it reaches the
 *   registry, so no control characters, whitespace, or leading dash can ever be
 *   interpreted downstream as anything but a literal preset name;
 * - repeating a flag fails instead of last-wins, because a shell alias and an
 *   explicit flag disagreeing is a bug worth surfacing;
 * - persistence is opt-in: `--remember` is only accepted together with
 *   `--agentmode`, so a run never rewrites the user's profile by accident.
 */

import { LIMITS, PRESET_ID_PATTERN } from './constants.ts'

/** A successfully parsed invocation. */
export type Command =
  | { readonly kind: 'serve'; readonly preset: string | undefined; readonly remember: boolean }
  | { readonly kind: 'list' }
  | { readonly kind: 'help' }
  | { readonly kind: 'invalid'; readonly message: string }

const HELP_FLAGS = new Set(['-h', '--help'])
const LIST_FLAG = '--list-agentmodes'
const MODE_FLAG = '--agentmode'
const MODE_PREFIX = '--agentmode='
const REMEMBER_FLAG = '--remember'
const TERMINATOR = '--'

/** Reject ids that are empty, oversized, or outside the identifier grammar. */
export function validatePresetId(value: string): string | undefined {
  if (value.length === 0) return 'agent preset id must not be empty'
  if (value.length > LIMITS.presetIdLength) {
    return `agent preset id must be at most ${LIMITS.presetIdLength} characters`
  }
  if (!PRESET_ID_PATTERN.test(value)) {
    return 'agent preset id may only contain letters, digits, ".", "_" and "-", and must not start with a separator'
  }
  return undefined
}

/**
 * Parse the launcher's remaining arguments.
 * @param argv - immutable snapshot from `ctx.cmdlineArgs.get()`.
 * @returns the command to execute, or an `invalid` result carrying the reason.
 */
export function parseArgs(argv: readonly string[]): Command {
  let preset: string | undefined
  let remember = false
  let list = false
  let sawTerminator = false

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === undefined) continue

    if (sawTerminator) {
      return {
        kind: 'invalid',
        message: `unexpected argument "${arg}"; this app takes no positional arguments`,
      }
    }
    if (arg === TERMINATOR) {
      sawTerminator = true
      continue
    }
    if (HELP_FLAGS.has(arg)) return { kind: 'help' }
    if (arg === REMEMBER_FLAG) {
      if (remember) {
        return { kind: 'invalid', message: `option "${REMEMBER_FLAG}" specified more than once` }
      }
      remember = true
      continue
    }
    if (arg === LIST_FLAG) {
      if (list)
        return { kind: 'invalid', message: `option "${LIST_FLAG}" specified more than once` }
      list = true
      continue
    }
    if (arg === MODE_FLAG) {
      if (preset !== undefined) {
        return { kind: 'invalid', message: `option "${MODE_FLAG}" specified more than once` }
      }
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) {
        return { kind: 'invalid', message: `option "${MODE_FLAG} <preset>" argument missing` }
      }
      const problem = validatePresetId(value)
      if (problem !== undefined) return { kind: 'invalid', message: problem }
      preset = value
      index++
      continue
    }
    if (arg.startsWith(MODE_PREFIX)) {
      if (preset !== undefined) {
        return { kind: 'invalid', message: `option "${MODE_FLAG}" specified more than once` }
      }
      const value = arg.slice(MODE_PREFIX.length)
      const problem = validatePresetId(value)
      if (problem !== undefined) return { kind: 'invalid', message: problem }
      preset = value
      continue
    }
    return { kind: 'invalid', message: `unknown option "${arg}"` }
  }

  if (sawTerminator && !list && preset === undefined) {
    return {
      kind: 'invalid',
      message: 'unexpected argument "--"; this app takes no positional arguments',
    }
  }
  if (list) {
    if (remember) {
      return {
        kind: 'invalid',
        message: `option "${REMEMBER_FLAG}" requires "${MODE_FLAG} <preset>"`,
      }
    }
    return { kind: 'list' }
  }
  if (remember && preset === undefined) {
    return {
      kind: 'invalid',
      message: `option "${REMEMBER_FLAG}" requires "${MODE_FLAG} <preset>"`,
    }
  }
  return { kind: 'serve', preset, remember }
}

/** The help text this app owns; stdout, then exit 0. */
export const USAGE = `Usage: dsh --profile acp [options]

Serve automation clients over Agent Client Protocol stdio.

Options:
  --agentmode <preset>   agent preset every new ACP session runs
  --remember             persist --agentmode into this profile's settings, so
                         later launches reuse it without a flag
  --list-agentmodes      print the declared agent presets and exit
  -h, --help             show this help

Without --agentmode the profile's configured preset is used (the value set
through the settings UI, then this bundle's deployment default).

Examples:
  dsh --profile acp --agentmode cordis            run the "cordis" preset once
  dsh --profile acp --agentmode ptc --remember    make "ptc" this profile's default
  dsh --profile acp                               reuse the profile's configured preset
  dsh --profile acp --list-agentmodes             list this profile's declared presets
`
