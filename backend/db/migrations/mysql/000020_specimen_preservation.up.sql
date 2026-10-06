-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000020_specimen_preservation.up.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

-- Storage temperature does not tell us whether source material was fresh or
-- cryopreserved at collection. Preserve the uncertainty explicitly.
ALTER TABLE specimen ADD COLUMN preservation_state VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE specimen ADD CONSTRAINT ck_specimen_preservation_state
    CHECK (preservation_state IN ('FRESH', 'CRYOPRESERVED', 'UNKNOWN'));
