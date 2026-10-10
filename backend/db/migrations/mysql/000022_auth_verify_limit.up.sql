-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000022_auth_verify_limit.up.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

ALTER TABLE auth_login_challenge ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auth_login_challenge ADD COLUMN failed_window_started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
