/**
 * Package entry.
 *
 * The Cordis loader imports this module and reads the plugin triple
 * (`name` / `inject` / `apply`); `cordis.patch.yml` inserts the row by package
 * name, so nothing else is exported at runtime. `AgentModeError` and `CODES`
 * are re-exported for tests and for anyone driving the built bundle directly.
 */

export { apply, inject, name } from './plugin.ts'
export { AgentModeError, CODES } from './errors.ts'
export { parseArgs, USAGE, validatePresetId } from './args.ts'
export { formatRoster } from './plugin.ts'
