// Phase 6 — shared ERP types.
// ErpClient is the "socket" a real Oracle Fusion / SAP adapter implements; the
// mock client implements the same shape so we can build and prove the connector
// without real ERP credentials.

export interface SupplierAttributes {
  [oracleAttributeName: string]: unknown;
}

export interface UpsertResult {
  duplicate: boolean; // true if this idempotency key was already applied
  supplierId: string;
}

export interface ErpClient {
  /** Create-or-update a supplier. The idempotency key makes a repeat call a no-op. */
  upsertSupplier(attrs: SupplierAttributes, idempotencyKey: string): Promise<UpsertResult>;
}

/** A verified change ready to push outbound to an ERP. */
export interface VerifiedChange {
  vendorId: string;
  fieldName: string; // which field changed (gst_number / bank_account_num / …)
  verifiedValue: unknown;
  verifiedAt: string; // ISO — part of the idempotency fingerprint
  legalName?: string;
  gstNumber?: string;
  panNumber?: string;
  status?: string;
}
