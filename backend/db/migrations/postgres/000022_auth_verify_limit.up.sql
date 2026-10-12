ALTER TABLE auth_login_challenge ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0;
-- First verification starts the 24-hour window for existing and new challenges.
ALTER TABLE auth_login_challenge ADD COLUMN failed_window_started_at TIMESTAMP NOT NULL DEFAULT '2000-01-01 00:00:00';
