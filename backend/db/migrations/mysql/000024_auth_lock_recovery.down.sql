-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000024_auth_lock_recovery.down.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

DROP TABLE auth_login_failure;
ALTER TABLE auth_login_challenge DROP COLUMN locked_until;
