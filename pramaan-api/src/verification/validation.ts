// Phase 2 — local format pre-validation (ERD Section 6).
// We check the shape of a GSTIN / PAN / IFSC locally BEFORE spending money on a
// paid government API call. A junk number is rejected here, for free.

// GSTIN: 2-digit state code + 10-char PAN + 1 entity char + 'Z' + 1 checksum char.
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// PAN: 5 letters + 4 digits + 1 letter. The 4th letter encodes the holder type.
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// IFSC: 4-letter bank code + '0' (reserved) + 6-char branch code.
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function isValidGSTIN(value: string): boolean {
  return GSTIN_REGEX.test(value);
}

export function isValidPAN(value: string): boolean {
  return PAN_REGEX.test(value);
}

export function isValidIFSC(value: string): boolean {
  return IFSC_REGEX.test(value);
}
