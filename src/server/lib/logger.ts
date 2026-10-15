/**
 * Structured-ish logger. Deliberately tiny: the assessment asks for request
 * logging and AI interaction logging, not an observability stack. One place to
 * swap in pino/winston later without touching call sites.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, scope: string, message: string, meta?: Record<string, unknown>) {
  const line = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    ...(meta ?? {}),
  };
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(JSON.stringify(line));
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, meta?: Record<string, unknown>) => emit('debug', scope, message, meta),
    info: (message: string, meta?: Record<string, unknown>) => emit('info', scope, message, meta),
    warn: (message: string, meta?: Record<string, unknown>) => emit('warn', scope, message, meta),
    error: (message: string, meta?: Record<string, unknown>) => emit('error', scope, message, meta),
  };
}

export const logger = createLogger('app');
