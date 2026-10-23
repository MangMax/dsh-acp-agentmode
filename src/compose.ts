/**
 * Binding a preset to one freshly created Agent.
 *
 * `dsh-acp` builds its agents with `ctx.agents.create({ meta: { cwd }, setup })`
 * and never mounts a preset, so the composition is attached from outside on the
 * serial `agent/created` event. `select` is the public "before the first turn"
 * entry point and appends `agent-preset/selected` to the session log; a resumed
 * session is already past its first turn (where `select` refuses with
 * `agent-preset/locked`), so it keeps the preset recorded in its log and is
 * composed with `mount` instead.
 *
 * Failure policy: a bind failure must never fail the serial creation dispatch
 * (that would turn one unusable preset into a broken `session/new` for the
 * client). It degrades to a loud warning and, when the recorded preset was the
 * one that failed, retries with the requested one.
 */

import type { Reporter } from './log.ts'
import type { AgentRef, PresetService, ProjectionService } from './ports.ts'

/** What composition needs. */
export interface ComposeDeps {
  readonly presets: PresetService
  readonly projections: ProjectionService
  readonly reporter: Reporter
}

/** A resolved selection to fall back to. */
export interface Selection {
  readonly id: string
}

/**
 * Read the preset id a session recorded, if any.
 * @param value - `sessionProjections.stateOf(session, 'agentPreset')`.
 */
export function readRecordedPreset(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Whether a session has not started its first turn.
 *
 * Mirrors the predicate `agentPresets.select` enforces. An unknown shape is
 * treated as *not* blank so the safer `mount` path is taken: mounting never
 * throws `agent-preset/locked`, while selecting a started session does.
 * @param boundary - `sessionProjections.stateOf(session, 'turnBoundary')`.
 */
export function isBlank(boundary: unknown): boolean {
  if (boundary === undefined || boundary === null) return true
  if (typeof boundary !== 'object') return false
  const record = boundary as { openTurnStartSeq?: unknown; lastTurn?: unknown }
  return record.openTurnStartSeq === null && record.lastTurn === 0
}

/**
 * Attach the preset to the Agent in `agent/created`.
 * @param deps - registry, projections, reporter.
 * @param agent - the freshly created Agent.
 * @param selection - the resolved selection for this process.
 */
export async function composeAgent(
  deps: ComposeDeps,
  agent: AgentRef,
  selection: Selection,
): Promise<void> {
  const { presets, projections, reporter } = deps

  // Another composer already bound this Agent: subagent children join their
  // parent's revision inside their own setup, and a resumed session may have
  // been composed by an earlier instance of this plugin.
  if (presets.composedPreset(agent.ctx) !== undefined) return

  const recorded = readRecordedPreset(projections.stateOf(agent.session, 'agentPreset'))
  const wanted = recorded ?? selection.id
  const blank = isBlank(projections.stateOf(agent.session, 'turnBoundary'))

  const bind = async (id: string): Promise<void> => {
    if (blank) {
      await presets.select(agent, id)
      return
    }
    await presets.mount(agent.ctx, id)
  }

  try {
    await bind(wanted)
    return
  } catch (error) {
    reporter.warn(`could not bind preset "${wanted}" to session ${agent.id}: ${describe(error)}`)
  }

  if (wanted === selection.id) {
    reporter.warn(`session ${agent.id} runs without a preset composition`)
    return
  }

  try {
    await bind(selection.id)
    reporter.warn(`session ${agent.id} fell back to preset "${selection.id}"`)
  } catch (error) {
    reporter.warn(`session ${agent.id} runs without a preset composition: ${describe(error)}`)
  }
}

/** Compact description that never throws on hostile thrown values. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'unknown error'
}
