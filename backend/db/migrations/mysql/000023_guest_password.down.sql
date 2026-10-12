-- Refuse rollback while guest accounts exist; do not delete accounts or grant access implicitly.
ALTER TABLE auth_user DROP CHECK ck_auth_user_role;
ALTER TABLE auth_user ADD CONSTRAINT ck_auth_user_role CHECK (role IN ('admin', 'member'));
ALTER TABLE auth_user DROP COLUMN password_locked_until;
ALTER TABLE auth_user DROP COLUMN password_attempts;
ALTER TABLE auth_user DROP COLUMN password_hash;
