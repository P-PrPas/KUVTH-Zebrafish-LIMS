ALTER TABLE experiment_batch DROP CONSTRAINT ck_experiment_batch_well_plate_size;
ALTER TABLE experiment_batch DROP COLUMN well_plate_size;
ALTER TABLE embryo DROP COLUMN is_disabled;
ALTER TABLE embryo_observation DROP COLUMN is_disabled;
ALTER TABLE clone_fish DROP COLUMN is_disabled;
ALTER TABLE fish_observation DROP COLUMN is_disabled;
ALTER TABLE clone_fish DROP COLUMN sick_note;
ALTER TABLE fish_observation DROP COLUMN sick_note;
