-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000016_imported_fish_provenance.down.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

DROP INDEX ix_fish_import_job ON clone_fish;
ALTER TABLE clone_fish DROP FOREIGN KEY fk_fish_import_job;
ALTER TABLE clone_fish DROP COLUMN import_job_id;
