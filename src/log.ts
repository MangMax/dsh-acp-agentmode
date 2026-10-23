/**
 * The only writer of diagnostics.
 *
 * Rules enforced here, because they are easy to break at a call site:
 *
 * - stdout is never touched (the ACP peer owns it) — only `help` and the
 *   roster go to stdout, through the explicit `emit` helper in `plugin.ts`;
 * - every line is flattened, escape-free, bounded, and path-redacted;
 * - a fatal failure prints one line, not a stack, unless debug mode is on.
 */

import { describeError, describeStack, oneLine, redactPaths } from './sanitize.ts'
import type { AgentModeError } from './errors.ts'
import type { WriteStream } from './ports.ts'

/** Diagnostic sink. */
export interface Reporter {
  /** Operator-facing progress ("agent preset: cordis"). */
  info(message: string): void
  /** A degraded outcome that does not stop the process. */
  warn(message: string): void
  /** A classified failure, rendered as `error: <code>: <message>`. */
  failure(error: AgentModeError): void
}

/** Options for {@link createReporter}. */
export interface ReporterOptions {
  readonly stream: WriteStream
  readonly debug: boolean
  /** Path prefixes to redact (home directories). */
  readonly markers?: readonly string[]
  readonly prefix?: string
}

/**
 * Create the reporter.
 * @param options - sink, debug switch, and redaction markers.
 */
export function createReporter(options: ReporterOptions): Reporter {
  const prefix = options.prefix ?? '[acp-agentmode]'
  const markers = options.markers ?? []

  const line = (text: string): void => {
    options.stream.write(`${text}\n`)
  }
  const clean = (text: string): string => oneLine(redactPaths(oneLine(text), markers))

  return {
    info(message) {
      line(`${prefix} ${clean(message)}`)
    },
    warn(message) {
      line(`${prefix} warning: ${clean(message)}`)
    },
    failure(error) {
      line(`error: ${error.code}: ${clean(error.message)}`)
      if (!options.debug) return
      const trace = describeStack(error.cause ?? error)
      line(`${prefix} debug: cause: ${clean(describeError(error.cause ?? error))}`)
      if (trace.length > 0) line(`${prefix} debug: ${trace}`)
    },
  }
}

/** A reporter that discards everything; used by tests that do not assert logs. */
export const silentReporter: Reporter = {
  info: () => {},
  warn: () => {},
  failure: () => {},
}
