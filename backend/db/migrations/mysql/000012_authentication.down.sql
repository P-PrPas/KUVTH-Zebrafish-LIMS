-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000012_authentication.down.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

ALTER TABLE audit_log DROP FOREIGN KEY fk_audit_actor_user;
DROP INDEX ix_audit_actor ON audit_log;
ALTER TABLE audit_log DROP COLUMN actor_email;
ALTER TABLE audit_log DROP COLUMN actor_user_id;
DROP TABLE IF EXISTS auth_setting;
DROP TABLE IF EXISTS auth_device_sync;
DROP TABLE IF EXISTS auth_session;
DROP TABLE IF EXISTS auth_login_challenge;
DROP TABLE IF EXISTS auth_user;
