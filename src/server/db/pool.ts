import { Pool } from 'pg';
import { env } from '@/server/config/env';

/**
 * Single shared connection pool.
 *
 * Next.js dev mode hot-reloads modules, which would otherwise create a new pool
 * on every reload and exhaust Neon's connection limit. Caching the pool on
 * globalThis is the standard fix.
 *
 * Neon's pooled endpoint (the `-pooler` host in DATABASE_URL) already multiplexes
 * connections, so we keep max modest. TLS is required by Neon; `sslmode=require`
 * in the URL is handled explicitly so node-postgres accepts Neon's cert chain.
 */
const globalForPool = globalThis as unknown as { __pgPool?: Pool };

function createPool(): Pool {
  const needsSsl = env.DATABASE_URL.includes('sslmode=require');
  return new Pool({
    connectionString: env.DATABASE_URL,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export const pool = globalForPool.__pgPool ?? createPool();
if (env.NODE_ENV !== 'production') globalForPool.__pgPool = pool;

/** Thin typed query helper. Always parameterised — never string-interpolated. */
export async function query<T>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

/** Runs a callback inside a transaction, rolling back on any throw. */
export async function withTransaction<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
