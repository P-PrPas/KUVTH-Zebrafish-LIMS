ALTER TABLE auth_login_challenge ADD COLUMN locked_until TIMESTAMP NULL;
CREATE TABLE auth_login_failure (
    id CHAR(36) PRIMARY KEY,
    email VARCHAR(254) NOT NULL,
    failed_at TIMESTAMP NOT NULL
);
CREATE INDEX idx_auth_login_failure_email_at ON auth_login_failure (email, failed_at);
