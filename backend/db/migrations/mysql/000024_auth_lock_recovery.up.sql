-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000024_auth_lock_recovery.up.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

ALTER TABLE auth_login_challenge ADD COLUMN locked_until DATETIME(3) NULL;
CREATE TABLE auth_login_failure (
    id CHAR(36) PRIMARY KEY,
    email VARCHAR(254) NOT NULL,
    failed_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX idx_auth_login_failure_email_at ON auth_login_failure (email, failed_at);
