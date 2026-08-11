// Serverless-friendly Postgres pool. A small module-scoped pool is reused across
// warm function invocations; each request checks out one client (so a request's
// transaction + SET LOCAL run on a single connection) and releases it after.

import pg from 'pg';

const { Pool } = pg;
let pool: InstanceType<typeof Pool> | undefined;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}
