/**
 * One structured log line per event, and the one place the process writes one.
 *
 * The repository had no logger. `apps/api/src/errors/boundary.ts` declared a `log`
 * seam and nothing ever passed it, so every failure in the application reached a
 * `console.error(message, context)` — a message string and a loose object side by
 * side, not parseable, not queryable, and not filterable by anything except a human
 * reading lines. "Show me every 500 in the last hour, grouped by path" was not a
 * question the log could answer.
 *
 * This closes the seam with a real implementation and gives the whole API one
 * `LogSink`. The design constraint is narrow on purpose: **the log is not a
 * dependency.** It takes a sink function, has no imports, and can be constructed in
 * a test with a collector. That is what lets the boundary take a logger without
 * gaining an import that only production needs, and it is why this lives in
 * `observability/` rather than in a logging framework.
 *
 * Three properties it holds, each of which was a way the old arrangement could
 * lie:
 *
 *   - **A caller cannot relabel a record.** `level`, `msg`, `time`, and `service`
 *     are the record's identity. A caller that supplied them could forge a warning
 *     as an error, or vice versa, and an alerting rule keyed on `level` would be
 *     alerting on something a handler wrote. Reserved keys are kept under `fields`
 *     instead of being dropped, so the value is still readable and is visibly not
 *     the record's.
 *
 *   - **A failure while logging is still a failure.** A sink that throws must not
 *     propagate: the moment the logger can throw is the moment a request that was
 *     already failing loses its error response. A circular value in the context
 *     would do the same thing through `JSON.stringify`, so it is replaced with a
 *     marker rather than allowed to throw.
 *
 *   - **The cause survives.** `JSON.stringify(new Error('x'))` is `{}`. A failure
 *     record that loses the message is worse than no record, because it looks like
 *     a record.
 */

/** Severity, ordered so a deployment can filter at or above a level. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** One line of the log. */
export interface LogRecord {
  /** ISO 8601, so a line sorts chronologically as text. */
  time: string;
  level: LogLevel;
  /** The caller's short event name, not a sentence. */
  msg: string;
  /** Which process emitted it. */
  service: string;
  /**
   * A caller's values that collided with a reserved key.
   *
   * Nested rather than discarded: the value was passed for a reason, and losing it
   * silently is how a field went missing from a log without anyone noticing.
   */
  fields?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Where a rendered line goes. Injected, so production and tests differ only here. */
export type LogSink = (record: LogRecord) => void;

export interface LoggerOptions {
  service: string;
  /** Defaults to the stdout/stderr split below. */
  sink?: LogSink;
  /** Called when the sink itself throws. Defaults to writing to stderr. */
  onSinkError?: (failure: unknown) => void;
  /** Injected for a deterministic `time` in tests. */
  now?: () => Date;
}

export interface Logger {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
}

/** Fields the record owns. A caller cannot supply these at the top level. */
const RESERVED = new Set(['time', 'level', 'msg', 'service', 'fields']);

/** The default sink: diagnostics on stderr, everything else on stdout. */
function consoleSink(record: LogRecord): void {
  const line = JSON.stringify(record);
  // `console.info` rather than `console.log`: both write to stdout, and the lint
  // rule allows `info` while forbidding `log` in product code. A logger is exactly
  // the case where the rule's intent — no stray `log` calls to debug with — does
  // not apply, and picking `info` keeps the exemption at zero.
  if (record.level === 'error' || record.level === 'warn') console.error(line);
  else console.info(line);
}

/**
 * Renders any value as something `JSON.stringify` accepts.
 *
 * `ancestors` is a **path** set, not a seen set: a value is added before its
 * children are walked and removed afterwards. That distinction is the whole
 * difference between a cycle and a shared reference, and a diamond in an object
 * graph is ordinary — a job and a lease both holding the same request, the same
 * `Error` reachable from two branches. A set that was never unwound reported the
 * second occurrence as `[circular]`, which is a false claim in the one artefact
 * whose stated property is that the context survives.
 *
 * Errors are added to the path *before* their `cause` is walked, for the same
 * reason: `error.cause = error` is legal, and the Error branch used to return
 * before anything was tracked, so a self-referential cause recursed until the
 * stack blew — from inside the failure handler, taking the request with it.
 */
function serialisable(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value instanceof Error) {
    if (ancestors.has(value)) return `${value.name}: ${value.message} [circular]`;
    ancestors.add(value);
    try {
      return {
        name: value.name,
        message: value.message,
        ...(value.stack === undefined ? {} : { stack: value.stack }),
        ...(value.cause === undefined ? {} : { cause: serialisable(value.cause, ancestors) }),
      };
    } finally {
      ancestors.delete(value);
    }
  }
  if (value === null || typeof value !== 'object') return value;
  if (ancestors.has(value)) return '[circular]';
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => serialisable(item, ancestors));
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = serialisable(item, ancestors);
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * `serialisable`, wrapped so a value it cannot render becomes a marker rather than
 * a throw.
 *
 * `serialisable` is defensive about cycles and self-referential causes, and that
 * covers everything a plain object graph can do. It cannot cover a value whose
 * *own* getter throws, or a Proxy that throws on `ownKeys` — and this runs inside
 * the error handler, so a throw here replaces a coded 500 with an unhelpful crash
 * in the process reporting the original one.
 */
function render(value: unknown, ancestors: WeakSet<object>): unknown {
  try {
    return serialisable(value, ancestors);
  } catch (cause) {
    return `[unrenderable: ${cause instanceof Error ? cause.message : 'unknown'}]`;
  }
}

export function createLogger(options: LoggerOptions): Logger {
  const sink = options.sink ?? consoleSink;
  const now = options.now ?? ((): Date => new Date());
  const onSinkError =
    options.onSinkError ??
    ((failure: unknown): void => {
      console.error('logger: the sink threw', failure);
    });

  const emit = (level: LogLevel, msg: string, context: Record<string, unknown>): void => {
    // One shared path set for the whole record, not one per top-level key: a
    // value reachable from two keys is one value, and treating each key as its own
    // universe would report the second one as circular.
    const ancestors = new WeakSet<object>();
    const record: LogRecord = {
      time: now().toISOString(),
      level,
      msg,
      service: options.service,
    };
    const collided: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
      if (RESERVED.has(key)) collided[key] = render(value, ancestors);
      else record[key] = render(value, ancestors);
    }
    if (Object.keys(collided).length > 0) record['fields'] = collided;
    try {
      sink(record);
    } catch (failure) {
      // Swallowed deliberately. The caller is usually the error boundary, and a
      // logger that throws here replaces a coded 500 with an unhelpful crash.
      onSinkError(failure);
    }
  };

  return {
    debug: (msg, context = {}) => emit('debug', msg, context),
    info: (msg, context = {}) => emit('info', msg, context),
    warn: (msg, context = {}) => emit('warn', msg, context),
    error: (msg, context = {}) => emit('error', msg, context),
  };
}
