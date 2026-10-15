import { NextRequest } from 'next/server';
import { verifyToken, TokenPayload } from './jwt';
import { ApiError } from './errors';

const BEARER = /^Bearer\s+(.+)$/i;

/**
 * Extracts and verifies the bearer token. Kept as a pure function (rather than
 * Next middleware) so route handlers can control their own auth requirements —
 * `/api/auth/*` must stay public while everything else is guarded.
 */
export async function getAuth(req: NextRequest): Promise<TokenPayload> {
  const header = req.headers.get('authorization') ?? '';
  const match = header.match(BEARER);
  if (!match) throw ApiError.unauthorized('Missing bearer token');

  const payload = await verifyToken(match[1]);
  if (!payload) throw ApiError.unauthorized('Invalid or expired token');
  return payload;
}
