-- ============================================================================
-- Pramaan — Phase 5: let the compliance dashboard read alerts through RLS.
-- RLS is already enabled on `alerts` (Phase 1) with a tenant-isolation policy.
-- The dashboard reads as the normal app role 'authenticated', so it needs the
-- table privilege — RLS still restricts WHICH rows come back (own tenant only).
-- Safe to run once.
-- ============================================================================

grant select on alerts to authenticated;
