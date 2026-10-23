/**
 * Typed failures and the one place that maps them to exit codes.
 *
 * Exit codes are a public contract (scripts and editors branch on them), so
 * they are assigned here rather than at each throw site:
 *
 * - `2` the invocation itself is wrong (bad flag, bad preset id) — nothing ran;
 * - `3` the invocation is fine but the requested preset cannot be served
 *   (unknown, or declared but unusable) — the operator asked for something the
 *   profile cannot give;
 * - `4` the composition is wrong (this bundle applied outside the ACP app) —
 *   fix the profile, not the command line.
 */

import { EXIT } from './constants.ts'
import { describeError, oneLine } from './sanitize.ts'

/** Stable, greppable error codes. */
export const CODES = {
  usage: 'E_USAGE',
  presetUnknown: 'E_PRESET_UNKNOWN',
  presetUnusable: 'E_PRESET_UNUSABLE',
  registry: 'E_REGISTRY',
  environment: 'E_ENVIRONMENT',
  bind: 'E_BIND',
  settings: 'E_SETTINGS',
  internal: 'E_INTERNAL',
} as const

/** One of {@link CODES}. */
export type AgentModeCode = (typeof CODES)[keyof typeof CODES]

/** A failure this plugin can explain and classify. */
export class AgentModeError extends Error {
  readonly code: AgentModeCode
  readonly exitCode: number

  constructor(
    code: AgentModeCode,
    message: string,
    exitCode: number,
    options?: { cause?: unknown },
  ) {
    super(oneLine(message), options)
    this.name = 'AgentModeError'
    this.code = code
    this.exitCode = exitCode
  }
}

/** Build the usage failure for an unparseable invocation. */
export function usageError(message: string): AgentModeError {
  return new AgentModeError(CODES.usage, message, EXIT.usage)
}

/** Build the "this composition is not the ACP app" failure. */
export function environmentError(message: string, cause?: unknown): AgentModeError {
  return new AgentModeError(
    CODES.environment,
    message,
    EXIT.environment,
    cause === undefined ? undefined : { cause },
  )
}

/**
 * Normalize anything thrown into an {@link AgentModeError}.
 * @param error - a thrown value of unknown shape.
 * @param fallback - the code/exit code to use when it is already one of ours.
 */
export function toAgentModeError(
  error: unknown,
  fallback: { code: AgentModeCode; exitCode: number },
): AgentModeError {
  if (error instanceof AgentModeError) return error
  return new AgentModeError(fallback.code, describeError(error), fallback.exitCode, {
    cause: error,
  })
}

/** Read a property from an unknown thrown value without trusting its shape. */
function property(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined
  return (value as Record<string, unknown>)[key]
}

/** The registry's "no such definition is registered right now" code. */
export function isPresetNotFound(error: unknown): boolean {
  const direct = property(error, 'code')
  if (direct === 'agent-preset/not-found') return true
  return property(property(error, 'data'), 'code') === 'agent-preset/not-found'
}

/** A disposer aborted an in-flight wait; expected when an instance is replaced. */
export function isAbortError(error: unknown): boolean {
  return property(error, 'name') === 'AbortError'
}

/** Cordis' code for an effect attempted on a fiber a reload already replaced. */
export function isInactiveEffect(error: unknown): boolean {
  return property(error, 'code') === 'INACTIVE_EFFECT'
}

/**
 * Cordis throws a plain `Error` when a service name is already published.
 * Matching the message is intentional: the error carries no code.
 */
export function isDuplicateService(error: unknown): boolean {
  const message = property(error, 'message')
  return typeof message === 'string' && message.includes('has been registered')
}

/** Extract the registry's own explanation from an "unusable preset" failure. */
export function presetFailureReason(error: unknown): string {
  const reason = property(property(error, 'data'), 'reason')
  return typeof reason === 'string' && reason.length > 0 ? reason : describeError(error)
}
