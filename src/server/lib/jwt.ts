import { SignJWT, jwtVerify } from 'jose';
import { env } from '@/server/config/env';

/**
 * JWT access tokens signed with HS256 via `jose`.
 *
 * Tradeoff: stateless JWTs mean no server-side revocation. For a prototype that
 * is an acceptable tradeoff (documented in the README); a production system would
 * pair this with short access-token lifetimes and a refresh-token table.
 */
const secret = new TextEncoder().encode(env.JWT_SECRET);
const ALG = 'HS256';
const TOKEN_TTL = '12h';

export interface TokenPayload {
  sub: string; // user id
  email: string;
  businessId: string;
  role: string;
}

export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .setIssuer('appointment-chatbot')
    .sign(secret);
}

/** Returns the payload or null — callers decide whether null means 401. */
export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: 'appointment-chatbot' });
    if (typeof payload.sub !== 'string') return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ''),
      businessId: String(payload.businessId ?? ''),
      role: String(payload.role ?? 'member'),
    };
  } catch {
    return null;
  }
}
