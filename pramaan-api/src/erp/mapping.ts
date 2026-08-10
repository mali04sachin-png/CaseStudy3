// Phase 6 — attribute mapping.
// Translates Pramaan's verified vendor fields into Oracle Fusion supplier-master
// attribute names, so the connector sends Oracle what it expects.

import type { VerifiedChange, SupplierAttributes } from './types.ts';

export function mapVendorToOracleSupplier(change: VerifiedChange): SupplierAttributes {
  return {
    SupplierName: change.legalName ?? null,
    TaxRegistrationNumber: change.gstNumber ?? null, // Oracle's GST field
    TaxpayerId: change.panNumber ?? null, // Oracle's PAN field
    SupplierStatus: change.status ?? null,
    // The specific field that changed, echoed for the write-back record.
    ChangedAttribute: change.fieldName,
    ChangedValue: change.verifiedValue,
  };
}
