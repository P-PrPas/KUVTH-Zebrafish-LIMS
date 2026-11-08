-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000027_v5_import_contract.up.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

-- Match the customer v5 code lengths and allow an explicitly unknown treatment.
ALTER TABLE experiment_batch MODIFY treatment_group_id CHAR(36) NULL;
ALTER TABLE experiment_batch DROP INDEX uq_experiment_batch_code;
ALTER TABLE experiment_batch DROP COLUMN batch_code_norm;
ALTER TABLE experiment_batch MODIFY batch_code VARCHAR(150) NOT NULL;
ALTER TABLE experiment_batch ADD COLUMN batch_code_norm VARCHAR(150) GENERATED ALWAYS AS (LOWER(TRIM(batch_code))) STORED;
ALTER TABLE experiment_batch ADD CONSTRAINT uq_experiment_batch_code UNIQUE (batch_code_norm);

ALTER TABLE specimen DROP INDEX uq_specimen_live_code;
ALTER TABLE specimen DROP COLUMN specimen_code_norm;
ALTER TABLE specimen MODIFY specimen_code VARCHAR(150) NOT NULL;
ALTER TABLE specimen ADD COLUMN specimen_code_norm VARCHAR(150) GENERATED ALWAYS AS (LOWER(TRIM(specimen_code))) STORED;
ALTER TABLE specimen ADD CONSTRAINT uq_specimen_live_code UNIQUE (specimen_code_norm, live_code_marker);
