ALTER TABLE auth_login_challenge ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auth_login_challenge ADD COLUMN failed_window_started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
