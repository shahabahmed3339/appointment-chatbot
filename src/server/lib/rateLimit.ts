import { NextRequest } from 'next/server';
import { ApiError } from './errors';

/**
 * Fixed-window in-memory rate limiter.
 *
 * Why in-memory: this is a single-process prototype. It is honest about its
 * limitation — counters reset on redeploy and do not work across instances. The
 * README calls this out and names Redis as the production replacement. The point
 * being demonstrated is the *pattern* (limit auth and AI endpoints specifically),
 * not a distributed limiter.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

function clientKey(req: NextRequest): string {
  // x-forwarded-for is set by Vercel/proxies; fall back to a constant in local dev.
  const fwd = req.headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0].trim() : 'local';
  const route = new URL(req.url).pathname;
  return `${ip}:${route}`;
}

export function enforceRateLimit(req: NextRequest, opts: RateLimitOptions): void {
  const key = clientKey(req);
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return;
  }

  bucket.count += 1;
  if (bucket.count > opts.max) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    throw new ApiError('RATE_LIMITED', `Too many requests. Retry in ${retryAfter}s.`, {
      retryAfterSeconds: retryAfter,
    });
  }
}

/** Conservative defaults: AI calls are expensive, auth calls are abuse-prone. */
export const RATE_LIMITS = {
  auth: { windowMs: 60_000, max: 10 },
  chat: { windowMs: 60_000, max: 20 },
  default: { windowMs: 60_000, max: 120 },
} as const;
