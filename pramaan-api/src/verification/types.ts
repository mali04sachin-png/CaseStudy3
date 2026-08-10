// Phase 2 — shared types for the Government Registry Verification Layer (GRVL).
// The VerificationProvider interface is the "universal socket": every provider
// (eKYCNow, Deepvue, or a future one) implements it the same way, so swapping
// providers is a config change, not a rewrite.

export type VerificationStatus = 'VALID' | 'INVALID' | 'DEGRADED';

export type GstStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';

/** Normalized GSTIN verification result — the shape the rest of Pramaan consumes,
 *  regardless of which provider produced it. Maps to a `verification_records` row. */
export interface GstinResult {
  field: 'gst_number';
  input: string;
  status: VerificationStatus;
  legalName: string | null;
  gstStatus: GstStatus | null;
  registrationDate: string | null; // ISO date
  sourceRegistry: 'GSTN';
  sourceProvider: string; // which adapter served this result
  raw: unknown; // the provider's original payload, kept for the audit trail
  verifiedAt: string; // ISO timestamp
}

/** The abstraction every verification provider adapter must implement. */
export interface VerificationProvider {
  readonly name: string;
  verifyGSTIN(gstin: string): Promise<GstinResult>;
}
