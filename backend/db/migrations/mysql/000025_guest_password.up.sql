-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000025_guest_password.up.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

-- Version 23 existed on the redesign branch; main deployments already reached 24.
-- Preserve credentials when upgrading either history.
ALTER TABLE auth_user DROP CHECK ck_auth_user_role;
ALTER TABLE auth_user ADD CONSTRAINT ck_auth_user_role CHECK (role IN ('admin', 'member', 'guest'));
SET @column_ddl = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE auth_user ADD COLUMN password_hash VARCHAR(255) NULL', 'SELECT 1') FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'auth_user' AND column_name = 'password_hash');
PREPARE column_statement FROM @column_ddl;
EXECUTE column_statement;
DEALLOCATE PREPARE column_statement;
SET @column_ddl = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE auth_user ADD COLUMN password_attempts INTEGER NOT NULL DEFAULT 0', 'SELECT 1') FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'auth_user' AND column_name = 'password_attempts');
PREPARE column_statement FROM @column_ddl;
EXECUTE column_statement;
DEALLOCATE PREPARE column_statement;
SET @column_ddl = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE auth_user ADD COLUMN password_locked_until DATETIME(3) NULL', 'SELECT 1') FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'auth_user' AND column_name = 'password_locked_until');
PREPARE column_statement FROM @column_ddl;
EXECUTE column_statement;
DEALLOCATE PREPARE column_statement;
