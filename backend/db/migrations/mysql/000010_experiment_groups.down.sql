-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000010_experiment_groups.down.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

ALTER TABLE experiment_batch DROP FOREIGN KEY fk_batch_experiment_group;
DROP INDEX ix_batch_experiment_group ON experiment_batch;
ALTER TABLE experiment_batch DROP COLUMN experiment_group_id;
DROP TABLE experiment_group;
