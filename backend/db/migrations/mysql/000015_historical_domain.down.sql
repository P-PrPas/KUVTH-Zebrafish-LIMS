-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000015_historical_domain.down.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

DROP TABLE specimen_fish_link;
ALTER TABLE specimen DROP CHECK ck_specimen_type;
ALTER TABLE specimen DROP CHECK ck_specimen_kind;
ALTER TABLE specimen ADD CONSTRAINT ck_specimen_kind CHECK (specimen_kind IN ('CL', 'RT', 'DC'));
ALTER TABLE specimen ADD CONSTRAINT ck_specimen_type CHECK (specimen_type IN ('WHOLE_EMBRYO', 'CAUDAL_FIN_CLIP'));
ALTER TABLE specimen MODIFY clone_fish_id CHAR(36) NOT NULL;
ALTER TABLE site DROP COLUMN time_zone;
ALTER TABLE donor_cell_line DROP CHECK ck_donor_preparation;
ALTER TABLE donor_cell_line ADD CONSTRAINT ck_donor_preparation CHECK (preparation IN ('DISSOCIATED', 'CHUNKS'));
ALTER TABLE clone_fish DROP CHECK ck_fish_exit_consistent;
ALTER TABLE clone_fish DROP CHECK ck_fish_disposition;
ALTER TABLE clone_fish DROP CHECK ck_fish_life_state;
ALTER TABLE clone_fish DROP CHECK ck_fish_status;
ALTER TABLE clone_fish ADD CONSTRAINT ck_fish_status CHECK (status IN ('ALIVE', 'DEAD', 'FROZEN', 'DISCARDED'));
ALTER TABLE clone_fish ADD CONSTRAINT ck_fish_exit_consistent CHECK (
    (status = 'ALIVE' AND exit_date IS NULL AND exit_reason IS NULL) OR
    (status = 'DEAD' AND exit_date IS NOT NULL AND exit_reason = 'DEAD') OR
    (status = 'FROZEN' AND exit_date IS NOT NULL AND exit_reason = 'FROZEN') OR
    (status = 'DISCARDED' AND exit_date IS NOT NULL AND exit_reason IN ('DISCARDED', 'LOST'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
ALTER TABLE clone_fish DROP COLUMN disposition;
ALTER TABLE clone_fish DROP COLUMN life_state;
