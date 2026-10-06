-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000014_import_foundation.up.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

-- Import jobs are durable drafts. Source bytes and source cells remain immutable;
-- admin corrections are stored on import_record and import_issue.
CREATE TABLE import_job (
    id                   CHAR(36)     NOT NULL PRIMARY KEY,
    input_kind           VARCHAR(10)  NOT NULL,
    status               VARCHAR(20)  NOT NULL DEFAULT 'draft',
    created_by_user_id   CHAR(36)     NOT NULL,
    confirmed_by_user_id CHAR(36)         NULL,
    reverted_by_user_id  CHAR(36)         NULL,
    created_at           DATETIME(3)    NOT NULL,
    updated_at           DATETIME(3)    NOT NULL,
    confirmed_at         DATETIME(3)        NULL,
    reverted_at          DATETIME(3)        NULL,
    revision             BIGINT       NOT NULL DEFAULT 1,
    parser_version       VARCHAR(20)  NOT NULL,
    selection_json       TEXT         NOT NULL,
    note                 TEXT             NULL,
    CONSTRAINT fk_import_job_creator FOREIGN KEY (created_by_user_id) REFERENCES auth_user (id),
    CONSTRAINT fk_import_job_confirmer FOREIGN KEY (confirmed_by_user_id) REFERENCES auth_user (id),
    CONSTRAINT fk_import_job_reverter FOREIGN KEY (reverted_by_user_id) REFERENCES auth_user (id),
    CONSTRAINT ck_import_job_input CHECK (input_kind IN ('xlsx', 'csv_set')),
    CONSTRAINT ck_import_job_status CHECK (status IN ('draft', 'ready', 'committed', 'reverted')),
    CONSTRAINT ck_import_job_revision CHECK (revision > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX ix_import_job_created ON import_job (created_at, id);

CREATE TABLE import_source_file (
    id             CHAR(36)      NOT NULL PRIMARY KEY,
    job_id         CHAR(36)      NOT NULL,
    file_name      VARCHAR(255)  NOT NULL,
    sheet_name     VARCHAR(150)      NULL,
    encoding       VARCHAR(20)       NULL,
    media_type     VARCHAR(100)  NOT NULL,
    sha256         CHAR(64)      NOT NULL,
    size_bytes     BIGINT        NOT NULL,
    content        LONGBLOB         NOT NULL,
    created_at     DATETIME(3)     NOT NULL,
    CONSTRAINT fk_import_file_job FOREIGN KEY (job_id) REFERENCES import_job (id),
    CONSTRAINT ck_import_file_size CHECK (size_bytes > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX ix_import_file_job ON import_source_file (job_id);

-- One logical source item per row/cell path. A source row may yield several
-- observations, so source_locator is more precise than row_no alone.
CREATE TABLE import_record (
    id              CHAR(36)      NOT NULL PRIMARY KEY,
    job_id          CHAR(36)      NOT NULL,
    source_file_id  CHAR(36)      NOT NULL,
    sheet_name      VARCHAR(150)  NOT NULL,
    source_locator  VARCHAR(120)  NOT NULL,
    row_no          INTEGER       NOT NULL,
    record_kind     VARCHAR(40)   NOT NULL,
    natural_key     VARCHAR(300)      NULL,
    source_json     TEXT          NOT NULL,
    working_json    TEXT          NOT NULL,
    target_table    VARCHAR(64)       NULL,
    target_id       CHAR(36)          NULL,
    status          VARCHAR(20)   NOT NULL DEFAULT 'pending',
    created_at      DATETIME(3)     NOT NULL,
    updated_at      DATETIME(3)     NOT NULL,
    CONSTRAINT fk_import_record_job FOREIGN KEY (job_id) REFERENCES import_job (id),
    CONSTRAINT fk_import_record_file FOREIGN KEY (source_file_id) REFERENCES import_source_file (id),
    CONSTRAINT uq_import_record_source UNIQUE (job_id, source_file_id, sheet_name, source_locator, record_kind),
    CONSTRAINT ck_import_record_row CHECK (row_no > 0),
    CONSTRAINT ck_import_record_status CHECK (status IN ('pending', 'ready', 'imported', 'skipped'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX ix_import_record_job_kind ON import_record (job_id, record_kind, status);
CREATE INDEX ix_import_record_natural_key ON import_record (record_kind, natural_key);
CREATE INDEX ix_import_record_target ON import_record (target_table, target_id);

CREATE TABLE import_issue (
    id                  CHAR(36)      NOT NULL PRIMARY KEY,
    job_id              CHAR(36)      NOT NULL,
    record_id           CHAR(36)          NULL,
    source_file_id      CHAR(36)      NOT NULL,
    sheet_name          VARCHAR(150)  NOT NULL,
    source_locator      VARCHAR(120)      NULL,
    row_no              INTEGER           NULL,
    severity            VARCHAR(20)   NOT NULL,
    code                VARCHAR(80)   NOT NULL,
    source_column       VARCHAR(150)      NULL,
    message             TEXT          NOT NULL,
    source_value        TEXT              NULL,
    status              VARCHAR(20)   NOT NULL DEFAULT 'open',
    resolution_value    TEXT              NULL,
    resolution_reason   TEXT              NULL,
    resolved_by_user_id CHAR(36)          NULL,
    created_at          DATETIME(3)     NOT NULL,
    updated_at          DATETIME(3)     NOT NULL,
    CONSTRAINT fk_import_issue_job FOREIGN KEY (job_id) REFERENCES import_job (id),
    CONSTRAINT fk_import_issue_record FOREIGN KEY (record_id) REFERENCES import_record (id),
    CONSTRAINT fk_import_issue_file FOREIGN KEY (source_file_id) REFERENCES import_source_file (id),
    CONSTRAINT fk_import_issue_resolver FOREIGN KEY (resolved_by_user_id) REFERENCES auth_user (id),
    CONSTRAINT ck_import_issue_severity CHECK (severity IN ('warning', 'overridable', 'blocking')),
    CONSTRAINT ck_import_issue_status CHECK (status IN ('open', 'corrected', 'bypassed', 'dismissed')),
    CONSTRAINT ck_import_issue_bypass CHECK (severity <> 'blocking' OR status <> 'bypassed')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX ix_import_issue_job_status ON import_issue (job_id, status, severity);

-- Values from columns the live schema cannot yet represent stay available for
-- later admin-reviewed backfill, without changing the uploaded source file.
CREATE TABLE import_unmapped_field (
    id                 CHAR(36)      NOT NULL PRIMARY KEY,
    job_id             CHAR(36)      NOT NULL,
    record_id          CHAR(36)      NOT NULL,
    source_column      VARCHAR(150)  NOT NULL,
    source_value       TEXT              NULL,
    status             VARCHAR(20)   NOT NULL DEFAULT 'pending',
    target_table       VARCHAR(64)       NULL,
    target_id          CHAR(36)          NULL,
    target_field       VARCHAR(100)      NULL,
    applied_by_user_id CHAR(36)          NULL,
    applied_at         DATETIME(3)         NULL,
    created_at         DATETIME(3)     NOT NULL,
    CONSTRAINT fk_import_unmapped_job FOREIGN KEY (job_id) REFERENCES import_job (id),
    CONSTRAINT fk_import_unmapped_record FOREIGN KEY (record_id) REFERENCES import_record (id),
    CONSTRAINT fk_import_unmapped_applier FOREIGN KEY (applied_by_user_id) REFERENCES auth_user (id),
    CONSTRAINT ck_import_unmapped_status CHECK (status IN ('pending', 'applied', 'ignored'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX ix_import_unmapped_status ON import_unmapped_field (status, source_column);
CREATE INDEX ix_import_unmapped_target ON import_unmapped_field (target_table, target_id);

-- Legacy SCNT and control sheets can contain counts without embryo identities.
CREATE TABLE historical_stage_count (
    id                  CHAR(36)      NOT NULL PRIMARY KEY,
    import_job_id       CHAR(36)      NOT NULL,
    import_record_id    CHAR(36)      NOT NULL,
    batch_id            CHAR(36)          NULL,
    injection_lot_id    CHAR(36)          NULL,
    arm_type            VARCHAR(30)       NULL,
    ivf_phase           VARCHAR(20)       NULL,
    stage_label         VARCHAR(100)  NOT NULL,
    stage_definition_id CHAR(36)          NULL,
    observed_on         DATE              NULL,
    n_total             INTEGER           NULL,
    n_alive             INTEGER           NULL,
    n_normal            INTEGER           NULL,
    n_abnormal          INTEGER           NULL,
    numerator           INTEGER           NULL,
    denominator         INTEGER           NULL,
    raw_value           TEXT          NOT NULL,
    notes               TEXT              NULL,
    created_at          DATETIME(3)     NOT NULL,
    deleted_at          DATETIME(3)         NULL,
    CONSTRAINT fk_hist_count_job FOREIGN KEY (import_job_id) REFERENCES import_job (id),
    CONSTRAINT fk_hist_count_record FOREIGN KEY (import_record_id) REFERENCES import_record (id),
    CONSTRAINT fk_hist_count_batch FOREIGN KEY (batch_id) REFERENCES experiment_batch (id),
    CONSTRAINT fk_hist_count_lot FOREIGN KEY (injection_lot_id) REFERENCES injection_lot (id),
    CONSTRAINT fk_hist_count_stage FOREIGN KEY (stage_definition_id) REFERENCES stage_definition (id),
    CONSTRAINT ck_hist_count_ivf_phase CHECK (ivf_phase IS NULL OR ivf_phase IN ('before', 'after', 'unknown')),
    CONSTRAINT ck_hist_count_nonnegative CHECK (
        (n_total IS NULL OR n_total >= 0) AND
        (n_alive IS NULL OR n_alive >= 0) AND
        (n_normal IS NULL OR n_normal >= 0) AND
        (n_abnormal IS NULL OR n_abnormal >= 0) AND
        (numerator IS NULL OR numerator >= 0) AND
        (denominator IS NULL OR denominator >= 0)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX ix_hist_count_batch_stage ON historical_stage_count (batch_id, stage_definition_id);
CREATE INDEX ix_hist_count_job ON historical_stage_count (import_job_id);

-- Date-only or unmapped-stage observations cannot enter embryo_observation:
-- that table requires a real timestamp and timing metrics.
CREATE TABLE historical_observation (
    id                  CHAR(36)      NOT NULL PRIMARY KEY,
    import_job_id       CHAR(36)      NOT NULL,
    import_record_id    CHAR(36)      NOT NULL,
    embryo_id           CHAR(36)          NULL,
    clone_fish_id       CHAR(36)          NULL,
    observed_on         DATE              NULL,
    observed_at         DATETIME(3)         NULL,
    time_precision      VARCHAR(20)   NOT NULL,
    stage_label         VARCHAR(100)      NULL,
    stage_definition_id CHAR(36)          NULL,
    outcome             VARCHAR(30)       NULL,
    biological_condition VARCHAR(20)      NULL,
    raw_value           TEXT          NOT NULL,
    notes               TEXT              NULL,
    created_at          DATETIME(3)     NOT NULL,
    deleted_at          DATETIME(3)         NULL,
    CONSTRAINT fk_hist_obs_job FOREIGN KEY (import_job_id) REFERENCES import_job (id),
    CONSTRAINT fk_hist_obs_record FOREIGN KEY (import_record_id) REFERENCES import_record (id),
    CONSTRAINT fk_hist_obs_embryo FOREIGN KEY (embryo_id) REFERENCES embryo (id),
    CONSTRAINT fk_hist_obs_fish FOREIGN KEY (clone_fish_id) REFERENCES clone_fish (id),
    CONSTRAINT fk_hist_obs_stage FOREIGN KEY (stage_definition_id) REFERENCES stage_definition (id),
    CONSTRAINT ck_hist_obs_precision CHECK (time_precision IN ('exact', 'date', 'unknown')),
    CONSTRAINT ck_hist_obs_precision_values CHECK (
        (time_precision = 'exact' AND observed_at IS NOT NULL) OR
        (time_precision = 'date' AND observed_on IS NOT NULL) OR
        (time_precision = 'unknown' AND observed_at IS NULL)
    ),
    CONSTRAINT ck_hist_obs_subject CHECK (embryo_id IS NULL OR clone_fish_id IS NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX ix_hist_obs_embryo_date ON historical_observation (embryo_id, observed_on);
CREATE INDEX ix_hist_obs_fish_date ON historical_observation (clone_fish_id, observed_on);
CREATE INDEX ix_hist_obs_job ON historical_observation (import_job_id);
