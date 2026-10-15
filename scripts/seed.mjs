// Re-runs the seed migration only. Kept as a thin wrapper so `npm run db:seed`
// reads naturally next to `npm run db:migrate`.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { Client } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.join(__dirname, '..', '.env');
try {
  const raw = await readFile(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {}

const connectionString = process.env.DATABASE_URL;
const client = new Client({
  connectionString,
  ssl: connectionString?.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
});

const sql = await readFile(path.join(__dirname, '..', 'db', 'migrations', '0002_seed.sql'), 'utf8');
await client.connect();
await client.query(sql);
await client.end();
console.log('Seed complete. Demo login: demo@acme.test / Password123!');
