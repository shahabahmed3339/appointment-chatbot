import { NextRequest, NextResponse } from 'next/server';
import { logger } from './logger';

/**
 * Request logging + a request id. Wraps handlers so we capture method, path,
 * status, duration and the id. Correlating logs by request id is the cheap
 * version of tracing and pays for itself when debugging the AI path.
 */
export function withRequestLogging<Ctx>(
  handler: (req: NextRequest, ctx: Ctx) => Promise<NextResponse>,
) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse> => {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    const { pathname } = new URL(req.url);
    const log = logger;

    try {
      const res = await handler(req, ctx);
      log.info('request', {
        requestId,
        method: req.method,
        path: pathname,
        status: res.status,
        durationMs: Date.now() - started,
      });
      res.headers.set('x-request-id', requestId);
      return res;
    } catch (err) {
      log.error('request_failed', {
        requestId,
        method: req.method,
        path: pathname,
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}
