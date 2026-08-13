// Real GST verification via GSTINCheck (free tier: ~20 requests). Same
// VerificationProvider interface as the mocks, so it drops into the GRVL circuit
// breaker. Activated when GSTINCHECK_KEY is set (see api/_entry.ts).
//
// The free upstream is flaky (often "System error, try later"), so we retry a
// few times per lookup and cache a successful (real) result in memory — a warm
// instance then answers repeat lookups instantly and reliably.
//
// Docs: GET https://sheet.gstincheck.co.in/check/<API_KEY>/<GSTIN>
// Response: { flag, message, data: { lgnm, tradeNam, sts, rgdt, ctb, ... } }

import type { VerificationProvider, GstinResult, GstStatus } from '../types.ts';

const CACHE = new Map<string, GstinResult>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mapStatus(sts: string): GstStatus | null {
  if (/active/i.test(sts)) return 'ACTIVE';
  if (/cancel/i.test(sts)) return 'CANCELLED';
  if (/suspend|provisional|inactive/i.test(sts)) return 'SUSPENDED';
  return null;
}

async function callOnce(apiKey: string, gstin: string): Promise<GstinResult> {
  const url =
    'https://sheet.gstincheck.co.in/check/' +
    encodeURIComponent(apiKey) +
    '/' +
    encodeURIComponent(gstin);

  const res = await fetch(url);
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body.flag === false || (!body.data && !body.lgnm)) {
    throw new Error(body && body.message ? String(body.message) : `GSTINCheck HTTP ${res.status}`);
  }

  const info = body.data || body;
  return {
    field: 'gst_number',
    input: gstin,
    status: 'VALID',
    legalName: info.lgnm || info.tradeNam || null,
    gstStatus: mapStatus(String(info.sts || '')),
    registrationDate: info.rgdt || null,
    sourceRegistry: 'GSTN',
    sourceProvider: 'GSTINCheck',
    raw: body,
    verifiedAt: new Date().toISOString(),
  };
}

/** Fresh (uncached) GSTINCheck lookup with retries for the flaky free upstream.
 *  The monitor uses this directly — a periodic re-check must always see live data,
 *  never a cached earlier answer. Throws if every attempt fails. */
export async function gstinCheckLookup(apiKey: string, gstin: string): Promise<GstinResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await callOnce(apiKey, gstin);
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(700);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('GSTINCheck failed');
}

export class GstinCheckProvider implements VerificationProvider {
  readonly name = 'GSTINCheck';
  private readonly apiKey: string;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // On-demand verification caches a successful (real) result in memory, so a warm
  // instance answers repeat manual lookups instantly. Monitoring bypasses this.
  async verifyGSTIN(gstin: string): Promise<GstinResult> {
    const cached = CACHE.get(gstin);
    if (cached) return cached;
    const result = await gstinCheckLookup(this.apiKey, gstin);
    CACHE.set(gstin, result);
    return result;
  }
}
