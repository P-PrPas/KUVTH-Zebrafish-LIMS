-- Match the customer v5 code lengths and allow an explicitly unknown treatment.
ALTER TABLE experiment_batch ALTER COLUMN treatment_group_id DROP NOT NULL;
ALTER TABLE experiment_batch DROP CONSTRAINT uq_experiment_batch_code;
ALTER TABLE experiment_batch DROP COLUMN batch_code_norm;
ALTER TABLE experiment_batch ALTER COLUMN batch_code TYPE VARCHAR(150);
ALTER TABLE experiment_batch ADD COLUMN batch_code_norm VARCHAR(150) GENERATED ALWAYS AS (LOWER(TRIM(batch_code))) STORED;
ALTER TABLE experiment_batch ADD CONSTRAINT uq_experiment_batch_code UNIQUE (batch_code_norm);

ALTER TABLE specimen DROP CONSTRAINT uq_specimen_live_code;
ALTER TABLE specimen DROP COLUMN specimen_code_norm;
ALTER TABLE specimen ALTER COLUMN specimen_code TYPE VARCHAR(150);
ALTER TABLE specimen ADD COLUMN specimen_code_norm VARCHAR(150) GENERATED ALWAYS AS (LOWER(TRIM(specimen_code))) STORED;
ALTER TABLE specimen ADD CONSTRAINT uq_specimen_live_code UNIQUE (specimen_code_norm, live_code_marker);
