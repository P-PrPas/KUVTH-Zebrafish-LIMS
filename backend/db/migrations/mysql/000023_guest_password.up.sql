-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000023_guest_password.up.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

ALTER TABLE auth_user DROP CHECK ck_auth_user_role;
ALTER TABLE auth_user ADD CONSTRAINT ck_auth_user_role CHECK (role IN ('admin', 'member', 'guest'));
ALTER TABLE auth_user ADD COLUMN password_hash VARCHAR(255) NULL;
ALTER TABLE auth_user ADD COLUMN password_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auth_user ADD COLUMN password_locked_until DATETIME(3) NULL;
