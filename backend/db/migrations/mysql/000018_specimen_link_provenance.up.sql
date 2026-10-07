-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000018_specimen_link_provenance.up.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

ALTER TABLE specimen_fish_link ADD COLUMN import_job_id CHAR(36) NULL;
ALTER TABLE specimen_fish_link ADD CONSTRAINT fk_specimen_link_import_job
    FOREIGN KEY (import_job_id) REFERENCES import_job (id);
CREATE INDEX ix_specimen_link_import_job ON specimen_fish_link (import_job_id);
