// Phase 3 — Postgres connection to Supabase. Reads DATABASE_URL from the env.

import pg from 'pg';

const { Client } = pg;

export function createClient(connectionString: string | undefined = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  return new Client({ connectionString, ssl: { rejectUnauthorized: false } });
}
