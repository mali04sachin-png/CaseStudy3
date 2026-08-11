// Real GST verification via GSTINCheck (free tier: ~20 requests). Same
// VerificationProvider interface as the mocks, so it drops into the GRVL circuit
// breaker. Activated when GSTINCHECK_KEY is set (see api/_entry.ts).
//
// Docs: GET https://sheet.gstincheck.co.in/check/<API_KEY>/<GSTIN>
// Response: { flag, message, data: { lgnm, tradeNam, sts, rgdt, ctb, ... } }

import type { VerificationProvider, GstinResult, GstStatus } from '../types.ts';

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
    const url =
      'https://sheet.gstincheck.co.in/check/' +
      encodeURIComponent(this.apiKey) +
      '/' +
      encodeURIComponent(gstin);

    const res = await fetch(url);
    const body: any = await res.json().catch(() => ({}));

    // flag:false (or no data) means the lookup failed → throw so the circuit
    // breaker fails over to the backup provider.
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
