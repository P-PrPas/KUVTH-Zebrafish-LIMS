-- Retain the owner-confirmed MSU correction when rolling back schema changes.

ALTER TABLE recipient_egg_lot DROP COLUMN donor_fish_code;
ALTER TABLE donor_cell_line DROP COLUMN sample_info, DROP COLUMN preservation;
ALTER TABLE fish_observation DROP CONSTRAINT ck_fish_observation_health_status;
ALTER TABLE fish_observation DROP COLUMN health_status;
ALTER TABLE clone_fish DROP CONSTRAINT ck_fish_health_status;
ALTER TABLE clone_fish DROP CONSTRAINT IF EXISTS fk_fish_recipient_egg_lot;
DROP INDEX IF EXISTS ix_fish_recipient_egg_lot;
ALTER TABLE clone_fish DROP COLUMN health_status, DROP COLUMN recipient_egg_lot_id;
ALTER TABLE injection_lot DROP COLUMN n_manipulated;
