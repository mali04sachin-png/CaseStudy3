-- ============================================================================
-- Pramaan — Phase 1: Foundation
-- Database schema + multi-tenant Row-Level Security + immutability triggers
-- Target: PostgreSQL 15+ (Supabase)
--
-- Build order source: Pramaan_Implementation_Plan.md (Phase 1)
-- Schema source:      Pramaan_ERD_Engineering_Requirements.md (Section 2 & 5)
--
-- Run this whole file once in the Supabase SQL Editor.
-- It is idempotent-ish for a FRESH project; do not re-run over live data.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- 1. Enumerated types
-- ---------------------------------------------------------------------------
create type msme_tier      as enum ('MICRO', 'SMALL', 'MEDIUM', 'NOT_APPLICABLE');
create type vendor_status  as enum ('ACTIVE', 'SUSPENDED', 'DEREGISTERED', 'UNVERIFIED');
create type erp_provider   as enum ('SAP_ARIBA', 'ORACLE_FUSION', 'NETSUITE', 'STANDALONE');
create type user_role      as enum ('VENDOR', 'COMPLIANCE', 'BUYER_ADMIN');
create type alert_severity as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
create type alert_status   as enum ('NEW', 'ASSIGNED', 'REASSESSED', 'RESOLVED', 'MUTED');
create type sync_dir       as enum ('INBOUND', 'OUTBOUND', 'TWO_WAY');

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- 2.1 vendors — shared-core anchor (one row per vendor company)
create table vendors (
    id          uuid primary key default gen_random_uuid(),
    legal_name  varchar(255) not null,
    vendor_type varchar(50)  not null,   -- Proprietary / Partnership / Private Limited
    created_at  timestamptz  not null default now()
);

-- 2.2 buyers — one row per tenant company
create table buyers (
    id         uuid primary key default gen_random_uuid(),
    org_name   varchar(255) not null,
    erp_type   erp_provider not null,
    created_at timestamptz  not null default now()
);

-- 2.3 trust_passports — verified core: statutory identity + per-field recency
create table trust_passports (
    id                          uuid primary key default gen_random_uuid(),
    vendor_id                   uuid not null references vendors(id) on delete cascade,
    gst_number                  varchar(15) unique,
    pan_number                  varchar(10) unique,
    cin                         varchar(21) unique,
    bank_account_num_encrypted  bytea,                       -- AES-256 encrypted at app layer
    bank_ifsc                   varchar(11),
    registered_address          jsonb not null,
    msme_classification         msme_tier not null,
    udyam_registration_num      varchar(19) unique,
    status                      vendor_status not null,
    gst_last_verified_at        timestamptz,
    pan_last_verified_at        timestamptz,
    udyam_last_verified_at      timestamptz,
    bank_last_verified_at       timestamptz,
    created_at                  timestamptz not null default now(),
    updated_at                  timestamptz not null default now(),
    unique (vendor_id)                                       -- enforces 1—1 vendor:passport
);

-- 2.4 verification_records — immutable proof log (every government check ever run)
create table verification_records (
    id              uuid primary key default gen_random_uuid(),
    passport_id     uuid not null references trust_passports(id) on delete cascade,
    field_name      varchar(50) not null,   -- gst_number / pan_number / bank_account / udyam
    source_registry varchar(50) not null,   -- GSTN / PROTEAN / UDYAM / MCA
    source_provider varchar(50) not null,   -- eKYCNow / AuthBridge / etc.
    verified_value  jsonb not null,
    status          varchar(50) not null,   -- VALID / INVALID / DEGRADED
    verified_at     timestamptz not null default now()
);

-- 2.5 users — one row per login identity (role fixed forever at creation)
create table users (
    id                  uuid primary key default gen_random_uuid(),
    email               varchar(255) not null unique,
    password_hash       varchar(255),
    sso_subject         varchar(255),
    role                user_role not null,
    buyer_id            uuid references buyers(id),
    vendor_id           uuid references vendors(id),
    invited_by_user_id  uuid references users(id),
    status              varchar(50) not null default 'PENDING_FIRST_LOGIN',
    created_at          timestamptz not null default now(),
    role_assigned_at    timestamptz not null default now(),
    -- role_scope_check: a VENDOR is tied to a vendor only; COMPLIANCE/BUYER_ADMIN to a buyer only
    constraint role_scope_check check (
        (role = 'VENDOR'
             and vendor_id is not null and buyer_id is null)
        or
        (role in ('COMPLIANCE', 'BUYER_ADMIN')
             and buyer_id is not null and vendor_id is null)
    )
);

-- 2.6 buyer_vendor_links — the junction that makes reuse real (one vendor ↔ many buyers)
create table buyer_vendor_links (
    id                   uuid primary key default gen_random_uuid(),
    buyer_id             uuid not null references buyers(id)  on delete restrict,
    vendor_id            uuid not null references vendors(id) on delete restrict,
    tenant_overlay_data  jsonb not null default '{}'::jsonb,
    internal_criticality varchar(50) not null default 'NON_ESSENTIAL',  -- CRITICAL/SIGNIFICANT/NON_ESSENTIAL
    shared_at            timestamptz not null default now(),
    unique (buyer_id, vendor_id)
);

-- 2.7 materiality_rules — decides what counts as an urgent change
create table materiality_rules (
    id                   uuid primary key default gen_random_uuid(),
    field_name           varchar(50) not null,
    internal_criticality varchar(50) not null,   -- CRITICAL / SIGNIFICANT / NON_ESSENTIAL
    severity             alert_severity not null,
    affected_process     varchar(50) not null,   -- PAYMENT / TAX / CONTRACT / COMPLIANCE
    routed_to_role       varchar(50) not null,   -- FINANCE / COMPLIANCE / LEGAL / PROCUREMENT
    unique (field_name, internal_criticality)
);

-- 2.8 alerts — a flagged change: what changed, how severe, where routed
create table alerts (
    id               uuid primary key default gen_random_uuid(),
    vendor_id        uuid not null references vendors(id) on delete cascade,
    buyer_id         uuid not null references buyers(id)  on delete cascade,
    change_type      varchar(50) not null,   -- BANK_CHANGE / GST_SUSPENDED / MSME_CLASS_SHIFT
    severity         alert_severity not null,
    affected_process varchar(50) not null,
    routed_to_role   varchar(50) not null,
    raw_delta        jsonb not null,         -- {"before": ..., "after": ...}
    status           alert_status not null default 'NEW',
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

-- 2.9 consent_records — the DPDP Act 2023 consent trail (mandatory)
create table consent_records (
    id                  uuid primary key default gen_random_uuid(),
    vendor_id           uuid not null references vendors(id) on delete cascade,
    purpose             text not null,
    consent_given_at    timestamptz not null,
    consent_manager_ref varchar(255) not null,
    is_withdrawn        boolean not null default false,
    withdrawn_at        timestamptz
);

-- 2.10 erp_connections — one row per buyer's SAP/Oracle connection
create table erp_connections (
    id                    uuid primary key default gen_random_uuid(),
    buyer_id              uuid not null references buyers(id) on delete cascade,
    erp_type              erp_provider not null,
    connection_status     varchar(50) not null,   -- CONNECTED / DEGRADED / DISCONNECTED
    last_synced_at        timestamptz,
    sync_direction        sync_dir not null,
    last_pull_watermark   timestamptz,
    credentials_vault_ref varchar(255) not null    -- vault/KMS reference, never raw credentials
);

-- 2.11 audit_log_entries — immutable system audit log (append-only at the DB layer)
create table audit_log_entries (
    id          bigserial primary key,
    entity_type varchar(50)  not null,   -- trust_passports / alerts / consent_records
    entity_id   uuid         not null,
    action      varchar(50)  not null,   -- CREATE / UPDATE / VERIFY_FAIL / ALERT_ROUTED
    actor       varchar(100) not null,   -- system_cme, or a user's email
    old_state   jsonb,
    new_state   jsonb,
    "timestamp" timestamptz  not null default now()
);

-- Helpful indexes for tenant-scoped lookups
create index idx_bvl_buyer          on buyer_vendor_links(buyer_id);
create index idx_bvl_vendor         on buyer_vendor_links(vendor_id);
create index idx_alerts_buyer       on alerts(buyer_id);
create index idx_alerts_vendor      on alerts(vendor_id);
create index idx_erpconn_buyer      on erp_connections(buyer_id);
create index idx_vrec_passport      on verification_records(passport_id);
create index idx_users_buyer        on users(buyer_id);
create index idx_users_vendor       on users(vendor_id);

-- ---------------------------------------------------------------------------
-- 3. Immutability triggers
-- ---------------------------------------------------------------------------

-- 3.1 users.role is frozen forever: block any UPDATE that changes role or role_assigned_at
create or replace function enforce_role_immutability()
returns trigger
language plpgsql
as $$
begin
    if new.role is distinct from old.role then
        raise exception 'users.role is immutable: a new role requires a new account (was %, tried %)',
            old.role, new.role;
    end if;
    if new.role_assigned_at is distinct from old.role_assigned_at then
        raise exception 'users.role_assigned_at is immutable';
    end if;
    return new;
end;
$$;

create trigger trg_users_role_immutable
    before update on users
    for each row
    execute function enforce_role_immutability();

-- 3.2 audit_log_entries is append-only: block every UPDATE and DELETE
create or replace function block_audit_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'audit_log_entries is append-only: % is not permitted', tg_op;
end;
$$;

create trigger trg_audit_no_update
    before update on audit_log_entries
    for each row
    execute function block_audit_mutation();

create trigger trg_audit_no_delete
    before delete on audit_log_entries
    for each row
    execute function block_audit_mutation();

-- ---------------------------------------------------------------------------
-- 4. Multi-tenant Row-Level Security
--    Isolation is keyed on the session variable app.current_buyer_id.
--    The application sets it per request:  SET app.current_buyer_id = '<uuid>';
--    Supabase's service_role bypasses RLS (for the backend workers/CME).
-- ---------------------------------------------------------------------------

-- Small helper: read the current tenant from the session, NULL if unset.
create or replace function current_buyer_id()
returns uuid
language sql
stable
as $$
    select nullif(current_setting('app.current_buyer_id', true), '')::uuid;
$$;

-- Enable + force RLS on the tenant-scoped tables
alter table buyer_vendor_links enable row level security;
alter table alerts             enable row level security;
alter table erp_connections    enable row level security;

alter table buyer_vendor_links force row level security;
alter table alerts             force row level security;
alter table erp_connections    force row level security;

-- One policy per table: a row is visible/writable only when its buyer_id
-- matches the tenant bound to the current session.
create policy tenant_isolation_bvl on buyer_vendor_links
    using      (buyer_id = current_buyer_id())
    with check (buyer_id = current_buyer_id());

create policy tenant_isolation_alerts on alerts
    using      (buyer_id = current_buyer_id())
    with check (buyer_id = current_buyer_id());

create policy tenant_isolation_erpconn on erp_connections
    using      (buyer_id = current_buyer_id())
    with check (buyer_id = current_buyer_id());

-- ---------------------------------------------------------------------------
-- 5. Seed: materiality_rules (from ERD Section 4.B — reference data, safe to seed now)
-- ---------------------------------------------------------------------------
insert into materiality_rules (field_name, internal_criticality, severity, affected_process, routed_to_role) values
    ('bank_account_num', 'CRITICAL',      'CRITICAL', 'PAYMENT',    'FINANCE'),
    ('bank_account_num', 'SIGNIFICANT',   'CRITICAL', 'PAYMENT',    'FINANCE'),
    ('bank_account_num', 'NON_ESSENTIAL', 'CRITICAL', 'PAYMENT',    'FINANCE'),
    ('gst_number',       'CRITICAL',      'HIGH',     'TAX',        'FINANCE'),
    ('gst_number',       'SIGNIFICANT',   'HIGH',     'TAX',        'FINANCE'),
    ('gst_number',       'NON_ESSENTIAL', 'MEDIUM',   'COMPLIANCE', 'PROCUREMENT'),
    ('msme_classification','CRITICAL',    'HIGH',     'TAX',        'FINANCE'),
    ('msme_classification','SIGNIFICANT', 'HIGH',     'TAX',        'FINANCE'),
    ('msme_classification','NON_ESSENTIAL','HIGH',    'TAX',        'FINANCE'),
    ('registered_address','CRITICAL',     'MEDIUM',   'CONTRACT',   'LEGAL'),
    ('registered_address','NON_ESSENTIAL','LOW',      'COMPLIANCE', 'PROCUREMENT');

-- ============================================================================
-- End of Phase 1 migration.
-- ============================================================================
