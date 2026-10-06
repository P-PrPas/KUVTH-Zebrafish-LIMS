-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000021_historical_experiments.down.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

DROP INDEX ix_hist_embryo_historical_lot ON historical_embryo;
DROP INDEX ix_hist_embryo_historical_experiment ON historical_embryo;
ALTER TABLE historical_embryo DROP FOREIGN KEY fk_hist_embryo_historical_lot;
ALTER TABLE historical_embryo DROP FOREIGN KEY fk_hist_embryo_historical_experiment;
ALTER TABLE historical_embryo DROP COLUMN historical_lot_id;
ALTER TABLE historical_embryo DROP COLUMN historical_experiment_id;
DROP INDEX ix_hist_count_historical_lot ON historical_stage_count;
DROP INDEX ix_hist_count_historical_experiment ON historical_stage_count;
ALTER TABLE historical_stage_count DROP FOREIGN KEY fk_hist_count_historical_lot;
ALTER TABLE historical_stage_count DROP FOREIGN KEY fk_hist_count_historical_experiment;
ALTER TABLE historical_stage_count DROP COLUMN historical_lot_id;
ALTER TABLE historical_stage_count DROP COLUMN historical_experiment_id;
DROP TABLE historical_lot;
DROP TABLE historical_experiment;
