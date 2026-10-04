-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000010_experiment_groups.up.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

-- Optional parent groups preserve existing batches without guessing their ownership.
CREATE TABLE experiment_group (
    id CHAR(36) NOT NULL,
    code VARCHAR(50) NOT NULL,
    code_norm VARCHAR(50) GENERATED ALWAYS AS (LOWER(TRIM(code))) STORED,
    name VARCHAR(200) NOT NULL,
    description TEXT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    deleted_at DATETIME(3) NULL,
    row_version BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT pk_experiment_group PRIMARY KEY (id),
    CONSTRAINT uq_experiment_group_code UNIQUE (code_norm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
ALTER TABLE experiment_batch ADD COLUMN experiment_group_id CHAR(36) NULL;
ALTER TABLE experiment_batch ADD CONSTRAINT fk_batch_experiment_group
    FOREIGN KEY (experiment_group_id) REFERENCES experiment_group (id);
CREATE INDEX ix_batch_experiment_group ON experiment_batch (experiment_group_id);
