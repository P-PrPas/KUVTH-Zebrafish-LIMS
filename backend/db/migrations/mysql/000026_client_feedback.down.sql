-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000026_client_feedback.down.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

ALTER TABLE experiment_batch DROP CHECK ck_experiment_batch_well_plate_size;
ALTER TABLE experiment_batch DROP COLUMN well_plate_size;
ALTER TABLE embryo DROP COLUMN is_disabled;
ALTER TABLE embryo_observation DROP COLUMN is_disabled;
ALTER TABLE clone_fish DROP COLUMN is_disabled;
ALTER TABLE clone_fish DROP COLUMN disability_at_registration;
ALTER TABLE fish_observation DROP COLUMN is_disabled;
ALTER TABLE clone_fish DROP COLUMN sick_note;
ALTER TABLE fish_observation DROP COLUMN sick_note;
