// Real GST verification via AppyFlow (free tier: ~50 requests). Implements the
// same VerificationProvider interface as the mocks, so it drops straight into
// the GRVL circuit breaker. Activated when APPYFLOW_KEY is set (see api/_entry.ts);
// on any error it throws, so the breaker fails over to the backup provider.
//
// Docs: GET https://appyflow.in/api/verifyGST?gstNo=<GST>&key_secret=<key>
// Response: { taxpayerInfo: { lgnm, tradeNam, sts, rgdt, ctb, ... }, error, message }

import type { VerificationProvider, GstinResult, GstStatus } from '../types.ts';

function mapStatus(sts: string): GstStatus | null {
  if (/active/i.test(sts)) return 'ACTIVE';
  if (/cancel/i.test(sts)) return 'CANCELLED';
  if (/suspend/i.test(sts)) return 'SUSPENDED';
  return null;
}

export class AppyFlowProvider implements VerificationProvider {
  readonly name = 'AppyFlow';
  constructor(private readonly keySecret: string) {}

  async verifyGSTIN(gstin: string): Promise<GstinResult> {
    const url =
      'https://appyflow.in/api/verifyGST?gstNo=' +
      encodeURIComponent(gstin) +
      '&key_secret=' +
      encodeURIComponent(this.keySecret);

    const res = await fetch(url, { headers: { 'content-type': 'application/json' } });
    const data: any = await res.json().catch(() => ({}));

    if (!res.ok || data.error) {
      throw new Error(data && data.message ? String(data.message) : `AppyFlow HTTP ${res.status}`);
    }

    const info = data.taxpayerInfo || data;
    return {
      field: 'gst_number',
      input: gstin,
      status: 'VALID',
      legalName: info.lgnm || info.tradeNam || null,
      gstStatus: mapStatus(String(info.sts || '')),
      registrationDate: info.rgdt || null,
      sourceRegistry: 'GSTN',
      sourceProvider: this.name,
      raw: data,
      verifiedAt: new Date().toISOString(),
    };
  }
}
