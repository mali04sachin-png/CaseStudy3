-- ============================================================================
-- Pramaan — Phase 1 Acceptance Tests
-- Run this AFTER 01_phase1_foundation.sql, in the Supabase SQL Editor.
-- Each block prints PASS or raises/So you can see the guarantee holds.
--
-- Acceptance criteria (from Pramaan_Implementation_Plan.md, Phase 1):
--   1. Migration runs with no warnings.                      (verified by running 01)
--   2. UPDATE/DELETE on audit_log_entries throws.
--   3. Buyer A never sees Buyer B's buyer_vendor_links rows.
--   4. Changing a users row's role throws.
--   5. role_scope_check rejects a VENDOR with no vendor_id, etc.
-- ============================================================================

-- Seed two tenants + one shared vendor for the isolation test.
insert into buyers (id, org_name, erp_type) values
    ('11111111-1111-1111-1111-111111111111', 'Buyer A', 'STANDALONE'),
    ('22222222-2222-2222-2222-222222222222', 'Buyer B', 'ORACLE_FUSION');

insert into vendors (id, legal_name, vendor_type) values
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ravi Logistics', 'Proprietary');

-- The service role bypasses RLS, so insert both links here as "admin".
insert into buyer_vendor_links (buyer_id, vendor_id) values
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- ---------------------------------------------------------------------------
-- TEST 3 — Tenant isolation: acting as Buyer A must return exactly 1 row,
-- never Buyer B's link to the same shared vendor.
-- NOTE: RLS is bypassed by service_role/superuser. Run these two lines as a
-- NON-privileged role (e.g. Supabase 'authenticated') to see it bite. To force
-- the check even as owner, the tables use FORCE ROW LEVEL SECURITY, so a plain
-- session role sees it. Set the tenant, then count:
set app.current_buyer_id = '11111111-1111-1111-1111-111111111111';
select case when count(*) = 1 then 'PASS: tenant isolation (A sees only its own)'
            else 'FAIL: saw ' || count(*) || ' rows' end
from buyer_vendor_links;

-- ---------------------------------------------------------------------------
-- TEST 2 — audit_log is append-only. Insert one row, then prove UPDATE fails.
insert into audit_log_entries (entity_type, entity_id, action, actor)
values ('alerts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'CREATE', 'system_cme');

do $$
begin
    update audit_log_entries set actor = 'tampered' where actor = 'system_cme';
    raise exception 'FAIL: audit_log UPDATE was allowed';
exception
    when others then
        if sqlerrm like '%append-only%' then
            raise notice 'PASS: audit_log UPDATE blocked (%).', sqlerrm;
        else
            raise; -- some other, unexpected error
        end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 4 — role is immutable. Create a VENDOR user, then try to promote it.
insert into users (id, email, role, vendor_id)
values ('99999999-9999-9999-9999-999999999999', 'ravi@example.com', 'VENDOR',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

do $$
begin
    update users set role = 'BUYER_ADMIN'
    where id = '99999999-9999-9999-9999-999999999999';
    raise exception 'FAIL: role change was allowed';
exception
    when others then
        if sqlerrm like '%immutable%' then
            raise notice 'PASS: role change blocked (%).', sqlerrm;
        else
            raise;
        end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 5 — role_scope_check rejects a malformed user (VENDOR with no vendor_id).
do $$
begin
    insert into users (email, role) values ('bad@example.com', 'VENDOR');
    raise exception 'FAIL: malformed VENDOR row was allowed';
exception
    when check_violation then
        raise notice 'PASS: role_scope_check rejected VENDOR with no vendor_id.';
end;
$$;

-- ---------------------------------------------------------------------------
-- Cleanup (optional): remove test rows so the DB is clean for real data.
-- Comment out if you want to inspect the rows first.
reset app.current_buyer_id;
delete from users              where email in ('ravi@example.com');
delete from buyer_vendor_links where vendor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
delete from vendors            where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
delete from buyers             where id in ('11111111-1111-1111-1111-111111111111',
                                            '22222222-2222-2222-2222-222222222222');
-- audit_log_entries rows cannot be deleted (by design) — that is expected.
