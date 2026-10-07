-- V2 source embryos have identities and observations, but often lack the
-- mandatory operator, protocol, and timing profile for an operational lot.
CREATE TABLE historical_embryo (
    id                    CHAR(36)      NOT NULL PRIMARY KEY,
    import_job_id         CHAR(36)      NOT NULL,
    import_record_id      CHAR(36)      NOT NULL,
    source_key            VARCHAR(300) NOT NULL,
    source_running_no     VARCHAR(60)      NULL,
    experiment_date       DATE         NOT NULL,
    site_id               CHAR(36)     NOT NULL,
    activation_local_time VARCHAR(5)       NULL,
    activation_source     VARCHAR(100)     NULL,
    recipient_source      VARCHAR(300)     NULL,
    egg_code_source       VARCHAR(150)     NULL,
    group_source          VARCHAR(150)     NULL,
    injection_source      VARCHAR(150)     NULL,
    lot_no_source         VARCHAR(100)     NULL,
    created_at            TIMESTAMP    NOT NULL,
    deleted_at            TIMESTAMP        NULL,
    live_marker           CHAR(36) GENERATED ALWAYS AS (
                              CASE WHEN deleted_at IS NULL THEN '0' ELSE id END
                          ) STORED,
    CONSTRAINT uq_historical_embryo_source UNIQUE (source_key, live_marker),
    CONSTRAINT uq_historical_embryo_record UNIQUE (import_record_id),
    CONSTRAINT fk_hist_embryo_job FOREIGN KEY (import_job_id) REFERENCES import_job (id),
    CONSTRAINT fk_hist_embryo_record FOREIGN KEY (import_record_id) REFERENCES import_record (id),
    CONSTRAINT fk_hist_embryo_site FOREIGN KEY (site_id) REFERENCES site (id)
);
CREATE INDEX ix_hist_embryo_job ON historical_embryo (import_job_id);
ALTER TABLE historical_observation ADD COLUMN historical_embryo_id CHAR(36) NULL;
ALTER TABLE historical_observation ADD CONSTRAINT fk_hist_obs_historical_embryo
    FOREIGN KEY (historical_embryo_id) REFERENCES historical_embryo (id);
CREATE INDEX ix_hist_obs_historical_embryo ON historical_observation (historical_embryo_id, observed_on);
ALTER TABLE historical_observation DROP CONSTRAINT ck_hist_obs_subject;
ALTER TABLE historical_observation ADD CONSTRAINT ck_hist_obs_subject CHECK (
    (CASE WHEN embryo_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN clone_fish_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN historical_embryo_id IS NULL THEN 0 ELSE 1 END) <= 1
);
