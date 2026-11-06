-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000027_v5_import_contract.down.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

-- Refuse rollback while v5 data exceeds the old contract; never truncate codes.
ALTER TABLE experiment_batch ADD CONSTRAINT ck_v5_batch_rollback CHECK (CHAR_LENGTH(batch_code) <= 100);
ALTER TABLE specimen ADD CONSTRAINT ck_v5_specimen_rollback CHECK (CHAR_LENGTH(specimen_code) <= 50);
ALTER TABLE experiment_batch MODIFY treatment_group_id CHAR(36) NOT NULL;
ALTER TABLE experiment_batch DROP INDEX uq_experiment_batch_code;
ALTER TABLE experiment_batch DROP COLUMN batch_code_norm;
ALTER TABLE experiment_batch MODIFY batch_code VARCHAR(100) NOT NULL;
ALTER TABLE experiment_batch ADD COLUMN batch_code_norm VARCHAR(100) GENERATED ALWAYS AS (LOWER(TRIM(batch_code))) STORED;
ALTER TABLE experiment_batch ADD CONSTRAINT uq_experiment_batch_code UNIQUE (batch_code_norm);
ALTER TABLE experiment_batch DROP CHECK ck_v5_batch_rollback;

ALTER TABLE specimen DROP INDEX uq_specimen_live_code;
ALTER TABLE specimen DROP COLUMN specimen_code_norm;
ALTER TABLE specimen MODIFY specimen_code VARCHAR(50) NOT NULL;
ALTER TABLE specimen ADD COLUMN specimen_code_norm VARCHAR(50) GENERATED ALWAYS AS (LOWER(TRIM(specimen_code))) STORED;
ALTER TABLE specimen ADD CONSTRAINT uq_specimen_live_code UNIQUE (specimen_code_norm, live_code_marker);
ALTER TABLE specimen DROP CHECK ck_v5_specimen_rollback;
