ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS fk_audit_actor_user;
DROP INDEX IF EXISTS ix_audit_actor;
ALTER TABLE audit_log DROP COLUMN IF EXISTS actor_email;
ALTER TABLE audit_log DROP COLUMN IF EXISTS actor_user_id;
DROP TABLE IF EXISTS auth_setting;
DROP TABLE IF EXISTS auth_device_sync;
DROP TABLE IF EXISTS auth_session;
DROP TABLE IF EXISTS auth_login_challenge;
DROP TABLE IF EXISTS auth_user;
