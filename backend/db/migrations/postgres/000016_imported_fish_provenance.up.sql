ALTER TABLE clone_fish ADD COLUMN import_job_id CHAR(36) NULL;
ALTER TABLE clone_fish ADD CONSTRAINT fk_fish_import_job
    FOREIGN KEY (import_job_id) REFERENCES import_job (id);
CREATE INDEX ix_fish_import_job ON clone_fish (import_job_id);
