-- Legacy batches and lots can lack operational protocol/operator/timing fields.
-- Keep their source identity and relationships without fabricating those fields.
CREATE TABLE historical_experiment (
    id                 CHAR(36)     NOT NULL PRIMARY KEY,
    import_job_id      CHAR(36)     NOT NULL,
    source_key         CHAR(64)     NOT NULL,
    source_sheet       VARCHAR(150) NOT NULL,
    source_kind        VARCHAR(30)  NOT NULL,
    experiment_date    DATE             NULL,
    site_id            CHAR(36)         NULL,
    recipient_source   VARCHAR(300)     NULL,
    egg_code_source    VARCHAR(150)     NULL,
    group_source       VARCHAR(150)     NULL,
    csof_source        VARCHAR(150)     NULL,
    created_at         TIMESTAMP    NOT NULL,
    deleted_at         TIMESTAMP        NULL,
    live_marker        CHAR(36) GENERATED ALWAYS AS (
                           CASE WHEN deleted_at IS NULL THEN '0' ELSE id END
                       ) STORED,
    CONSTRAINT uq_hist_experiment_source UNIQUE (source_key, live_marker),
    CONSTRAINT fk_hist_experiment_job FOREIGN KEY (import_job_id) REFERENCES import_job (id),
    CONSTRAINT fk_hist_experiment_site FOREIGN KEY (site_id) REFERENCES site (id)
);
CREATE INDEX ix_hist_experiment_job ON historical_experiment (import_job_id);

CREATE TABLE historical_lot (
    id                    CHAR(36)     NOT NULL PRIMARY KEY,
    import_job_id         CHAR(36)     NOT NULL,
    historical_experiment_id CHAR(36) NOT NULL,
    source_key            CHAR(64)     NOT NULL,
    lot_no_source         VARCHAR(100)     NULL,
    donor_source          VARCHAR(300)     NULL,
    injection_source      VARCHAR(300)     NULL,
    activation_local_time VARCHAR(5)       NULL,
    created_at            TIMESTAMP    NOT NULL,
    deleted_at            TIMESTAMP        NULL,
    live_marker           CHAR(36) GENERATED ALWAYS AS (
                              CASE WHEN deleted_at IS NULL THEN '0' ELSE id END
                          ) STORED,
    CONSTRAINT uq_hist_lot_source UNIQUE (source_key, live_marker),
    CONSTRAINT fk_hist_lot_job FOREIGN KEY (import_job_id) REFERENCES import_job (id),
    CONSTRAINT fk_hist_lot_experiment FOREIGN KEY (historical_experiment_id) REFERENCES historical_experiment (id)
);
CREATE INDEX ix_hist_lot_job ON historical_lot (import_job_id);
CREATE INDEX ix_hist_lot_experiment ON historical_lot (historical_experiment_id);

ALTER TABLE historical_stage_count ADD COLUMN historical_experiment_id CHAR(36) NULL;
ALTER TABLE historical_stage_count ADD COLUMN historical_lot_id CHAR(36) NULL;
ALTER TABLE historical_stage_count ADD CONSTRAINT fk_hist_count_historical_experiment
    FOREIGN KEY (historical_experiment_id) REFERENCES historical_experiment (id);
ALTER TABLE historical_stage_count ADD CONSTRAINT fk_hist_count_historical_lot
    FOREIGN KEY (historical_lot_id) REFERENCES historical_lot (id);
CREATE INDEX ix_hist_count_historical_experiment ON historical_stage_count (historical_experiment_id);
CREATE INDEX ix_hist_count_historical_lot ON historical_stage_count (historical_lot_id);

ALTER TABLE historical_embryo ADD COLUMN historical_experiment_id CHAR(36) NULL;
ALTER TABLE historical_embryo ADD COLUMN historical_lot_id CHAR(36) NULL;
ALTER TABLE historical_embryo ADD CONSTRAINT fk_hist_embryo_historical_experiment
    FOREIGN KEY (historical_experiment_id) REFERENCES historical_experiment (id);
ALTER TABLE historical_embryo ADD CONSTRAINT fk_hist_embryo_historical_lot
    FOREIGN KEY (historical_lot_id) REFERENCES historical_lot (id);
CREATE INDEX ix_hist_embryo_historical_experiment ON historical_embryo (historical_experiment_id);
CREATE INDEX ix_hist_embryo_historical_lot ON historical_embryo (historical_lot_id);
