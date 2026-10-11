-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000020_specimen_preservation.down.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

ALTER TABLE specimen DROP CHECK ck_specimen_preservation_state;
ALTER TABLE specimen DROP COLUMN preservation_state;
