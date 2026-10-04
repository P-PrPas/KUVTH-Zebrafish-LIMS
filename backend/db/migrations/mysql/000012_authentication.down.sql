-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000012_authentication.down.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

DROP INDEX IF EXISTS ix_audit_actor;
ALTER TABLE audit_log DROP FOREIGN KEY fk_audit_actor_user;
ALTER TABLE audit_log DROP COLUMN IF EXISTS actor_email;
ALTER TABLE audit_log DROP COLUMN IF EXISTS actor_user_id;
DROP TABLE IF EXISTS auth_setting;
DROP TABLE IF EXISTS auth_device_sync;
DROP INDEX IF EXISTS ix_auth_session_user;
DROP TABLE IF EXISTS auth_session;
DROP TABLE IF EXISTS auth_login_challenge;
DROP TABLE IF EXISTS auth_user;
