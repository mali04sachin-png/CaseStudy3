// Phase 7 — page-size guard. A client can ask for any page size; the server
// always clamps it: never below 1, default 100, and a HARD cap of 500 so a
// buyer can never pull an unbounded dump in one call.

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 500;

export function clampPageSize(requested?: number): number {
  if (requested === undefined || Number.isNaN(requested) || requested < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(requested), MAX_PAGE_SIZE);
}
