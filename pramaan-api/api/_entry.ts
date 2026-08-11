// Serverless entry (bundled by esbuild into api/index.mjs at build time, so there
// are no .ts import paths to resolve at runtime — see package.json "build").
// vercel.json rewrites every path here; this checks out one DB client per request
// (except health/preflight), runs the shared router, then releases it.

import { handle } from '../src/http/server.ts';
import { getPool } from '../src/db/pool.ts';
import { GRVL } from '../src/verification/grvl.ts';
import { MockVerificationProvider } from '../src/verification/providers/mock-provider.ts';
import { AppyFlowProvider } from '../src/verification/providers/appyflow.ts';
import { GstinCheckProvider } from '../src/verification/providers/gstincheck.ts';

// Verification uses mock providers until real GST/PAN API keys are added; login,
// alerts, pull, sharing etc. do not depend on it.
// Real provider (AppyFlow) as primary when a key is configured; the mock backup
// stays as the circuit-breaker failover. No key → all-mock (unchanged behavior).
const realKey = process.env.GSTINCHECK_KEY || process.env.APPYFLOW_KEY;
const primary = process.env.GSTINCHECK_KEY
  ? new GstinCheckProvider(process.env.GSTINCHECK_KEY)
  : process.env.APPYFLOW_KEY
    ? new AppyFlowProvider(process.env.APPYFLOW_KEY)
    : new MockVerificationProvider({ name: 'eKYCNow' });

// With a REAL provider, the backup must NOT fabricate an "active" result — if the
// real API errors/times out we return DEGRADED (unknown), never a fake pass.
// The real API is slow (~6s), so give the breaker a generous timeout.
const degradedBackup = {
  name: 'unavailable',
  async verifyGSTIN(gstin: string) {
    return {
      field: 'gst_number' as const,
      input: gstin,
      status: 'DEGRADED' as const,
      legalName: null,
      gstStatus: null,
      registrationDate: null,
      sourceRegistry: 'GSTN' as const,
      sourceProvider: 'unavailable',
      raw: {},
      verifiedAt: new Date().toISOString(),
    };
  },
};
const grvl = realKey
  ? new GRVL(primary, degradedBackup, { timeoutMs: 24000 })
  : new GRVL(primary, new MockVerificationProvider({ name: 'Deepvue' }));

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
