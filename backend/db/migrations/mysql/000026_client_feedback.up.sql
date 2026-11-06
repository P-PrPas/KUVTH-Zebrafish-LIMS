-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000026_client_feedback.up.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

ALTER TABLE experiment_batch ADD COLUMN well_plate_size INTEGER NOT NULL DEFAULT 96;
ALTER TABLE experiment_batch ADD CONSTRAINT ck_experiment_batch_well_plate_size CHECK (well_plate_size IN (6, 12, 24, 48, 96));
ALTER TABLE embryo ADD COLUMN is_disabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE embryo_observation ADD COLUMN is_disabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clone_fish ADD COLUMN is_disabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE fish_observation ADD COLUMN is_disabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clone_fish ADD COLUMN sick_note TEXT;
ALTER TABLE fish_observation ADD COLUMN sick_note TEXT;
UPDATE embryo_observation SET is_disabled = TRUE WHERE biological_condition = 'ABNORMAL';
UPDATE embryo SET is_disabled = TRUE WHERE first_abnormal_observation_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM embryo_observation WHERE embryo_observation.embryo_id = embryo.id
    AND embryo_observation.biological_condition = 'ABNORMAL' AND embryo_observation.deleted_at IS NULL
);
UPDATE fish_observation SET is_disabled = TRUE WHERE biological_condition = 'ABNORMAL' OR health_status = 'DISABLED';
UPDATE clone_fish SET is_disabled = TRUE WHERE biological_condition = 'ABNORMAL' OR health_status = 'DISABLED'
OR first_abnormal_on IS NOT NULL OR EXISTS (
    SELECT 1 FROM embryo WHERE embryo.id = clone_fish.embryo_id AND embryo.is_disabled = TRUE
) OR EXISTS (
    SELECT 1 FROM fish_observation WHERE fish_observation.clone_fish_id = clone_fish.id
    AND (fish_observation.biological_condition = 'ABNORMAL' OR fish_observation.health_status = 'DISABLED')
    AND fish_observation.deleted_at IS NULL
);
UPDATE clone_fish SET biological_condition = 'ABNORMAL' WHERE is_disabled = TRUE;
