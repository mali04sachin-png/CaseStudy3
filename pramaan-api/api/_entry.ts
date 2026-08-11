// Serverless entry (bundled by esbuild into api/index.mjs at build time, so there
// are no .ts import paths to resolve at runtime — see package.json "build").
// vercel.json rewrites every path here; this checks out one DB client per request
// (except health/preflight), runs the shared router, then releases it.

import { handle } from '../src/http/server.ts';
import { getPool } from '../src/db/pool.ts';
import { GRVL } from '../src/verification/grvl.ts';
import { MockVerificationProvider } from '../src/verification/providers/mock-provider.ts';
import { AppyFlowProvider } from '../src/verification/providers/appyflow.ts';

// Verification uses mock providers until real GST/PAN API keys are added; login,
// alerts, pull, sharing etc. do not depend on it.
// Real provider (AppyFlow) as primary when a key is configured; the mock backup
// stays as the circuit-breaker failover. No key → all-mock (unchanged behavior).
const primary = process.env.APPYFLOW_KEY
  ? new AppyFlowProvider(process.env.APPYFLOW_KEY)
  : new MockVerificationProvider({ name: 'eKYCNow' });
const grvl = new GRVL(primary, new MockVerificationProvider({ name: 'Deepvue' }));

export default async function handler(req: any, res: any) {
  const path = (req.url || '/').split('?')[0];

  // Health check and CORS preflight need no database.
  if (req.method === 'OPTIONS' || path === '/health' || path === '/') {
    return handle(req, res, { db: null, grvl });
  }

  let client;
  try {
    client = await getPool().connect();
  } catch (err: any) {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? '*');
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({ error: 'db_connect_failed', detail: String((err && err.message) || err) }),
    );
    return;
  }

  try {
    await handle(req, res, { db: client, grvl });
  } finally {
    client.release();
  }
}
