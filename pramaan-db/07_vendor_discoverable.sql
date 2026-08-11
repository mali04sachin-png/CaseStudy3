-- ============================================================================
-- Network / portability: a vendor can opt into being discoverable by OTHER
-- buyers in Pramaan's verified directory (DPDP-friendly, opt-in only). Only the
-- vendor's verified identity (shared core) is ever exposed cross-tenant — never
-- a buyer's private overlay/notes.
-- ============================================================================

alter table trust_passports
  add column if not exists is_discoverable boolean not null default false;
