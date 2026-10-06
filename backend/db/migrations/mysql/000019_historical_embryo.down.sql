-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000019_historical_embryo.down.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

ALTER TABLE historical_observation DROP CHECK ck_hist_obs_subject;
ALTER TABLE historical_observation ADD CONSTRAINT ck_hist_obs_subject
    CHECK (embryo_id IS NULL OR clone_fish_id IS NULL);
DROP INDEX ix_hist_obs_historical_embryo ON historical_observation;
ALTER TABLE historical_observation DROP FOREIGN KEY fk_hist_obs_historical_embryo;
ALTER TABLE historical_observation DROP COLUMN historical_embryo_id;
DROP TABLE historical_embryo;
