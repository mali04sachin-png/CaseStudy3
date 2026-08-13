-- ============================================================================
-- Pramaan — Vendor monitoring watchlist
-- Marks which vendors the continuous-monitoring scan should re-check against the
-- live GST registry. Kept small on purpose: the free registry API has a tiny
-- request budget, so only a handful of REAL vendors are ever flagged.
-- Idempotent — safe to re-run.
-- ============================================================================

alter table trust_passports
    add column if not exists monitored boolean not null default false;

-- The scan reads this each tick; a partial index keeps that lookup cheap.
create index if not exists idx_passports_monitored
    on trust_passports (monitored) where monitored;
