-- ============================================================================
-- Pramaan — Phase 4 prep: materiality rule correction.
-- Per ERD Section 4.B, a registered_address change on a NON_ESSENTIAL vendor is
-- a "silent update, logged to the audit trail, routed to none" — i.e. it must
-- NOT raise an active alert. Phase 1 seeded it as a low alert by mistake; fix it
-- to route to NONE so the Continuous Monitoring Engine treats it as log-only.
-- Safe to run once on the existing database.
-- ============================================================================

update materiality_rules
   set severity = 'LOW',
       affected_process = 'NONE',
       routed_to_role = 'NONE'
 where field_name = 'registered_address'
   and internal_criticality = 'NON_ESSENTIAL';
