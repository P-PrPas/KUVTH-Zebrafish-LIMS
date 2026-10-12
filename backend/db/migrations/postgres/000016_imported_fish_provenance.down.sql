ALTER TABLE clone_fish DROP CONSTRAINT IF EXISTS fk_fish_import_job;
DROP INDEX IF EXISTS ix_fish_import_job;
ALTER TABLE clone_fish DROP COLUMN import_job_id;
