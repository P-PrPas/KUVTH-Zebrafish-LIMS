ALTER TABLE specimen DROP CONSTRAINT uq_specimen_live_code;
ALTER TABLE specimen DROP COLUMN live_code_marker;
ALTER TABLE specimen ADD CONSTRAINT uq_specimen_code UNIQUE (specimen_code_norm);
ALTER TABLE clone_fish DROP CONSTRAINT uq_clone_fish_live_code;
ALTER TABLE clone_fish DROP COLUMN live_code_marker;
ALTER TABLE clone_fish ADD CONSTRAINT uq_clone_fish_code UNIQUE (fish_code_norm);
