ALTER TABLE auth_user DROP CONSTRAINT ck_auth_user_role;
ALTER TABLE auth_user ADD CONSTRAINT ck_auth_user_role CHECK (role IN ('admin', 'member', 'guest'));
ALTER TABLE auth_user ADD COLUMN password_hash VARCHAR(255) NULL;
ALTER TABLE auth_user ADD COLUMN password_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auth_user ADD COLUMN password_locked_until TIMESTAMP NULL;
