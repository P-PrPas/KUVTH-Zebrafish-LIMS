-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000022_auth_verify_limit.down.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

ALTER TABLE auth_login_challenge DROP COLUMN failed_window_started_at;
ALTER TABLE auth_login_challenge DROP COLUMN failed_count;
