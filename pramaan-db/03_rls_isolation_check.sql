-- ============================================================================
-- Pramaan — RLS Tenant-Isolation Check (run as a NON-privileged role)
-- The postgres/service role bypasses RLS by design; this proves the wall bites
-- for a normal application user (Supabase's 'authenticated' role).
-- Safe to re-run: it seeds, tests, and cleans up its own rows.
-- ============================================================================

-- Seed two tenants + one shared vendor (as postgres, RLS bypassed for setup).
insert into buyers (id, org_name, erp_type) values
    ('11111111-1111-1111-1111-111111111111', 'Buyer A', 'STANDALONE'),
    ('22222222-2222-2222-2222-222222222222', 'Buyer B', 'ORACLE_FUSION');
insert into vendors (id, legal_name, vendor_type) values
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ravi Logistics', 'Proprietary');
insert into buyer_vendor_links (buyer_id, vendor_id) values
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- The app user needs table privileges (RLS still restricts WHICH rows it sees).
grant select on buyer_vendor_links to authenticated;

-- Act as a normal logged-in user, bound to Buyer A's tenant.
set role authenticated;
set app.current_buyer_id = '11111111-1111-1111-1111-111111111111';

do $$
declare n int;
begin
    select count(*) into n from buyer_vendor_links;
    if n = 1 then
        raise notice 'PASS: as Buyer A, saw exactly 1 row (its own), never Buyer B''s.';
    else
        raise exception 'FAIL: as Buyer A, saw % rows (RLS not isolating)', n;
    end if;
end;
$$;

-- Switch tenant binding to Buyer B — should also see exactly its own 1 row.
set app.current_buyer_id = '22222222-2222-2222-2222-222222222222';
do $$
declare n int;
begin
    select count(*) into n from buyer_vendor_links;
    if n = 1 then
        raise notice 'PASS: as Buyer B, saw exactly 1 row (its own).';
    else
        raise exception 'FAIL: as Buyer B, saw % rows', n;
    end if;
end;
$$;

-- With NO tenant set, a normal user should see zero rows.
reset app.current_buyer_id;
do $$
declare n int;
begin
    select count(*) into n from buyer_vendor_links;
    if n = 0 then
        raise notice 'PASS: with no tenant bound, saw 0 rows (fails closed).';
    else
        raise exception 'FAIL: with no tenant bound, saw % rows (should be 0)', n;
    end if;
end;
$$;

-- Back to the privileged role and clean up.
reset role;
delete from buyer_vendor_links where vendor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
delete from vendors where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
delete from buyers  where id in ('11111111-1111-1111-1111-111111111111',
                                 '22222222-2222-2222-2222-222222222222');
