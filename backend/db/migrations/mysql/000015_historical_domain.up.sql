-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000015_historical_domain.up.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

-- Historical fish may have no verified current life state. Keep their recorded
-- disposition separate from biological status.
ALTER TABLE clone_fish DROP CHECK ck_fish_status;
ALTER TABLE clone_fish DROP CHECK ck_fish_exit_consistent;
ALTER TABLE clone_fish ADD COLUMN life_state VARCHAR(20) NULL;
ALTER TABLE clone_fish ADD COLUMN disposition VARCHAR(20) NULL;
ALTER TABLE clone_fish ADD CONSTRAINT ck_fish_status
    CHECK (status IN ('ALIVE', 'DEAD', 'FROZEN', 'DISCARDED', 'UNKNOWN'));
ALTER TABLE clone_fish ADD CONSTRAINT ck_fish_life_state
    CHECK (life_state IS NULL OR life_state IN ('ALIVE', 'DEAD', 'UNKNOWN'));
ALTER TABLE clone_fish ADD CONSTRAINT ck_fish_disposition
    CHECK (disposition IS NULL OR disposition IN ('NONE', 'FROZEN', 'DISCARDED', 'LOST', 'UNKNOWN'));
ALTER TABLE clone_fish ADD CONSTRAINT ck_fish_exit_consistent CHECK (
    (status = 'ALIVE' AND exit_date IS NULL AND exit_reason IS NULL) OR
    (status = 'DEAD' AND exit_date IS NOT NULL AND exit_reason = 'DEAD') OR
    (status = 'FROZEN' AND exit_date IS NOT NULL AND exit_reason = 'FROZEN') OR
    (status = 'DISCARDED' AND exit_date IS NOT NULL AND exit_reason IN ('DISCARDED', 'LOST')) OR
    (status = 'UNKNOWN' AND exit_reason IS NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
UPDATE clone_fish SET
    life_state = CASE WHEN status = 'ALIVE' THEN 'ALIVE' WHEN status = 'DEAD' THEN 'DEAD' ELSE 'UNKNOWN' END,
    disposition = CASE WHEN status = 'FROZEN' THEN 'FROZEN' WHEN status = 'DISCARDED' THEN 'DISCARDED' ELSE 'NONE' END;

-- Unknown cell preparation is an explicit source fact, not a guessed method.
ALTER TABLE donor_cell_line DROP CHECK ck_donor_preparation;
ALTER TABLE donor_cell_line ADD CONSTRAINT ck_donor_preparation
    CHECK (preparation IN ('DISSOCIATED', 'CHUNKS', 'UNKNOWN'));

-- Sites determine the local calendar used for historical observations.
ALTER TABLE site ADD COLUMN time_zone VARCHAR(64) NULL;
UPDATE site SET time_zone = 'Asia/Bangkok' WHERE code_norm = 'ku';
UPDATE site SET time_zone = 'America/Detroit' WHERE code_norm = 'msu';

-- RT/DC source material can be shared by several clone fish. The old direct
-- association remains for current forms; historical links use this table.
ALTER TABLE specimen MODIFY clone_fish_id CHAR(36) NULL;
ALTER TABLE specimen DROP CHECK ck_specimen_kind;
ALTER TABLE specimen DROP CHECK ck_specimen_type;
ALTER TABLE specimen ADD CONSTRAINT ck_specimen_kind
    CHECK (specimen_kind IN ('CL', 'CLA', 'RT', 'DC'));
ALTER TABLE specimen ADD CONSTRAINT ck_specimen_type
    CHECK (specimen_type IN (
        'WHOLE_EMBRYO', 'CAUDAL_FIN_CLIP', 'ANAL_FIN_CLIP',
        'LEFTOVER_CELLS', 'WHOLE_ADULT', 'UNKNOWN'
    ));
CREATE TABLE specimen_fish_link (
    specimen_id   CHAR(36) NOT NULL,
    clone_fish_id CHAR(36) NOT NULL,
    linked_at     DATETIME(3) NOT NULL,
    CONSTRAINT pk_specimen_fish_link PRIMARY KEY (specimen_id, clone_fish_id),
    CONSTRAINT fk_specimen_link_specimen FOREIGN KEY (specimen_id) REFERENCES specimen (id),
    CONSTRAINT fk_specimen_link_fish FOREIGN KEY (clone_fish_id) REFERENCES clone_fish (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX ix_specimen_link_fish ON specimen_fish_link (clone_fish_id);
INSERT INTO specimen_fish_link (specimen_id, clone_fish_id, linked_at)
    SELECT id, clone_fish_id, created_at FROM specimen WHERE clone_fish_id IS NOT NULL;
