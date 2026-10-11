ALTER TABLE historical_observation DROP CONSTRAINT ck_hist_obs_subject;
ALTER TABLE historical_observation ADD CONSTRAINT ck_hist_obs_subject
    CHECK (embryo_id IS NULL OR clone_fish_id IS NULL);
ALTER TABLE historical_observation DROP CONSTRAINT IF EXISTS fk_hist_obs_historical_embryo;
DROP INDEX IF EXISTS ix_hist_obs_historical_embryo;
ALTER TABLE historical_observation DROP COLUMN historical_embryo_id;
DROP TABLE historical_embryo;
