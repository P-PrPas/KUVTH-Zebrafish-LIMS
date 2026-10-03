-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000011_persist_feedback_fields.down.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

-- Retain the owner-confirmed MSU correction when rolling back schema changes.

ALTER TABLE recipient_egg_lot DROP COLUMN donor_fish_code;
ALTER TABLE donor_cell_line DROP COLUMN sample_info, DROP COLUMN preservation;
ALTER TABLE fish_observation DROP CHECK ck_fish_observation_health_status;
ALTER TABLE fish_observation DROP COLUMN health_status;
ALTER TABLE clone_fish DROP CHECK ck_fish_health_status;
ALTER TABLE clone_fish DROP FOREIGN KEY fk_fish_recipient_egg_lot;
DROP INDEX ix_fish_recipient_egg_lot ON clone_fish;
ALTER TABLE clone_fish DROP COLUMN health_status, DROP COLUMN recipient_egg_lot_id;
ALTER TABLE injection_lot DROP COLUMN n_manipulated;
