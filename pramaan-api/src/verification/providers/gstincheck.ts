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

export class GstinCheckProvider implements VerificationProvider {
  readonly name = 'GSTINCheck';
  constructor(private readonly apiKey: string) {}

  async verifyGSTIN(gstin: string): Promise<GstinResult> {
    const cached = CACHE.get(gstin);
    if (cached) return cached;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await this.callOnce(gstin);
        CACHE.set(gstin, result); // only successful (real) results are cached
        return result;
      } catch (e) {
        lastErr = e;
        if (attempt < 2) await sleep(700);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('GSTINCheck failed');
  }

  private async callOnce(gstin: string): Promise<GstinResult> {
    const url =
      'https://sheet.gstincheck.co.in/check/' +
      encodeURIComponent(this.apiKey) +
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
      sourceProvider: this.name,
      raw: body,
      verifiedAt: new Date().toISOString(),
    };
  }
}
