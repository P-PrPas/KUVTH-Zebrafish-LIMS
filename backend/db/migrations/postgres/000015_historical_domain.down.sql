DROP TABLE specimen_fish_link;
ALTER TABLE specimen DROP CONSTRAINT ck_specimen_type;
ALTER TABLE specimen DROP CONSTRAINT ck_specimen_kind;
ALTER TABLE specimen ADD CONSTRAINT ck_specimen_kind CHECK (specimen_kind IN ('CL', 'RT', 'DC'));
ALTER TABLE specimen ADD CONSTRAINT ck_specimen_type CHECK (specimen_type IN ('WHOLE_EMBRYO', 'CAUDAL_FIN_CLIP'));
ALTER TABLE specimen ALTER COLUMN clone_fish_id SET NOT NULL;
ALTER TABLE site DROP COLUMN time_zone;
ALTER TABLE donor_cell_line DROP CONSTRAINT ck_donor_preparation;
ALTER TABLE donor_cell_line ADD CONSTRAINT ck_donor_preparation CHECK (preparation IN ('DISSOCIATED', 'CHUNKS'));
ALTER TABLE clone_fish DROP CONSTRAINT ck_fish_exit_consistent;
ALTER TABLE clone_fish DROP CONSTRAINT ck_fish_disposition;
ALTER TABLE clone_fish DROP CONSTRAINT ck_fish_life_state;
ALTER TABLE clone_fish DROP CONSTRAINT ck_fish_status;
ALTER TABLE clone_fish ADD CONSTRAINT ck_fish_status CHECK (status IN ('ALIVE', 'DEAD', 'FROZEN', 'DISCARDED'));
ALTER TABLE clone_fish ADD CONSTRAINT ck_fish_exit_consistent CHECK (
    (status = 'ALIVE' AND exit_date IS NULL AND exit_reason IS NULL) OR
    (status = 'DEAD' AND exit_date IS NOT NULL AND exit_reason = 'DEAD') OR
    (status = 'FROZEN' AND exit_date IS NOT NULL AND exit_reason = 'FROZEN') OR
    (status = 'DISCARDED' AND exit_date IS NOT NULL AND exit_reason IN ('DISCARDED', 'LOST'))
);
ALTER TABLE clone_fish DROP COLUMN disposition;
ALTER TABLE clone_fish DROP COLUMN life_state;
