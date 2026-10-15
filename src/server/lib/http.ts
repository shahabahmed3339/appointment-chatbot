import { NextResponse } from 'next/server';
import { ApiError } from './errors';

/** Consistent success envelope: { data: ... } */
export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

/** Consistent error envelope: { error: { code, message, details? } } */
export function fail(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

/**
 * Wraps a route handler so every thrown error becomes a well-formed response
 * and every unexpected error is logged server-side but never leaked to clients.
 */
export function handle<Args extends unknown[]>(
  fn: (...args: Args) => Promise<NextResponse>,
) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status >= 500) console.error('[api]', err.code, err.message, err.details ?? '');
        return fail(err.code, err.message, err.status, err.details);
      }
      console.error('[api] unhandled error:', err);
      return fail('INTERNAL_ERROR', 'Something went wrong. Please try again.', 500);
    }
  };
}
