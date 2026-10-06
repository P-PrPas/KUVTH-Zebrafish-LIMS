-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000018_specimen_link_provenance.down.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

DROP INDEX ix_specimen_link_import_job ON specimen_fish_link;
ALTER TABLE specimen_fish_link DROP FOREIGN KEY fk_specimen_link_import_job;
ALTER TABLE specimen_fish_link DROP COLUMN import_job_id;
