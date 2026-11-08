-- Refuse rollback while v5 data exceeds the old contract; never truncate codes.
ALTER TABLE experiment_batch ADD CONSTRAINT ck_v5_batch_rollback CHECK (CHAR_LENGTH(batch_code) <= 100);
ALTER TABLE specimen ADD CONSTRAINT ck_v5_specimen_rollback CHECK (CHAR_LENGTH(specimen_code) <= 50);
ALTER TABLE experiment_batch ALTER COLUMN treatment_group_id SET NOT NULL;
ALTER TABLE experiment_batch DROP CONSTRAINT uq_experiment_batch_code;
ALTER TABLE experiment_batch DROP COLUMN batch_code_norm;
ALTER TABLE experiment_batch ALTER COLUMN batch_code TYPE VARCHAR(100);
ALTER TABLE experiment_batch ADD COLUMN batch_code_norm VARCHAR(100) GENERATED ALWAYS AS (LOWER(TRIM(batch_code))) STORED;
ALTER TABLE experiment_batch ADD CONSTRAINT uq_experiment_batch_code UNIQUE (batch_code_norm);
ALTER TABLE experiment_batch DROP CONSTRAINT ck_v5_batch_rollback;

ALTER TABLE specimen DROP CONSTRAINT uq_specimen_live_code;
ALTER TABLE specimen DROP COLUMN specimen_code_norm;
ALTER TABLE specimen ALTER COLUMN specimen_code TYPE VARCHAR(50);
ALTER TABLE specimen ADD COLUMN specimen_code_norm VARCHAR(50) GENERATED ALWAYS AS (LOWER(TRIM(specimen_code))) STORED;
ALTER TABLE specimen ADD CONSTRAINT uq_specimen_live_code UNIQUE (specimen_code_norm, live_code_marker);
ALTER TABLE specimen DROP CONSTRAINT ck_v5_specimen_rollback;
