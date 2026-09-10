ALTER TABLE experiment_batch DROP CONSTRAINT IF EXISTS fk_batch_experiment_group;
DROP INDEX IF EXISTS ix_batch_experiment_group;
ALTER TABLE experiment_batch DROP COLUMN experiment_group_id;
DROP TABLE experiment_group;
