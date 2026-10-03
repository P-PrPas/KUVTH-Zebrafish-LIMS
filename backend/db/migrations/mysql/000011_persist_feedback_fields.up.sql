-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000011_persist_feedback_fields.up.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

ALTER TABLE injection_lot
    ADD COLUMN n_manipulated INTEGER NULL;

ALTER TABLE clone_fish
    ADD COLUMN recipient_egg_lot_id CHAR(36) NULL,
    ADD COLUMN health_status VARCHAR(20) NOT NULL DEFAULT 'UNDETERMINED';
ALTER TABLE clone_fish
    ADD CONSTRAINT fk_fish_recipient_egg_lot
        FOREIGN KEY (recipient_egg_lot_id) REFERENCES recipient_egg_lot (id),
    ADD CONSTRAINT ck_fish_health_status
        CHECK (health_status IN ('HEALTHY', 'WEAK', 'SICK', 'DISABLED', 'AGED', 'UNDETERMINED'));
CREATE INDEX ix_fish_recipient_egg_lot ON clone_fish (recipient_egg_lot_id);

ALTER TABLE fish_observation
    ADD COLUMN health_status VARCHAR(20) NOT NULL DEFAULT 'UNDETERMINED';
ALTER TABLE fish_observation
    ADD CONSTRAINT ck_fish_observation_health_status
        CHECK (health_status IN ('HEALTHY', 'WEAK', 'SICK', 'DISABLED', 'AGED', 'UNDETERMINED'));

ALTER TABLE donor_cell_line
    ADD COLUMN preservation VARCHAR(20) NULL,
    ADD COLUMN sample_info TEXT NULL;

ALTER TABLE recipient_egg_lot
    ADD COLUMN donor_fish_code VARCHAR(150) NULL;

-- Correct the originally seeded MSU location without overwriting user-edited names.
UPDATE site
SET name = 'Michigan State University', updated_at = CURRENT_TIMESTAMP
WHERE code = 'MSU' AND name = 'Mahasarakham University';
