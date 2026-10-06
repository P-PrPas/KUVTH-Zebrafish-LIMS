DROP INDEX IF EXISTS ix_specimen_link_import_job;
ALTER TABLE specimen_fish_link DROP CONSTRAINT IF EXISTS fk_specimen_link_import_job;
ALTER TABLE specimen_fish_link DROP COLUMN import_job_id;
