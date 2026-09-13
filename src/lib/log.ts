/**
 * Structured JSON logging with correlation IDs.
 *
 * Every line is machine-parseable and carries whichever of dispatch_id, cycle_id,
 * provider_request_id, notification_id and watch_id are in scope.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  dispatch_id?: string;
  cycle_id?: string;
  provider_request_id?: string;
  notification_id?: string;
  watch_id?: string;
  user_id?: string;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): number {
  const configured = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;
  return LEVEL_ORDER[configured] ?? LEVEL_ORDER.info;
}

/** Never log a secret, even by accident. */
const REDACT_KEYS = /(api[_-]?key|secret|token|password|authorization|service[_-]?role)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

function emit(level: LogLevel, message: string, context: LogContext = {}): void {
  if (LEVEL_ORDER[level] < minLevel()) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: 'raildrop',
    msg: message,
    ...(redact(context) as Record<string, unknown>),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.warn(line);
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(context: LogContext): Logger;
}

export function createLogger(base: LogContext = {}): Logger {
  return {
    debug: (m, c) => emit('debug', m, { ...base, ...c }),
    info: (m, c) => emit('info', m, { ...base, ...c }),
    warn: (m, c) => emit('warn', m, { ...base, ...c }),
    error: (m, c) => emit('error', m, { ...base, ...c }),
    child: (c) => createLogger({ ...base, ...c }),
  };
}

export const log = createLogger();

/** Serialise an unknown thrown value into something safe to log and store. */
export function describeError(err: unknown): { name: string; message: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: 'UnknownError', message: String(err) };
}
