CREATE TABLE auth_user (
    id CHAR(36) NOT NULL,
    email VARCHAR(254) NOT NULL,
    role VARCHAR(10) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    verified_at TIMESTAMP NULL,
    invited_at TIMESTAMP NOT NULL,
    invited_by_user_id CHAR(36) NULL,
    operator_id CHAR(36) NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    CONSTRAINT pk_auth_user PRIMARY KEY (id),
    CONSTRAINT uq_auth_user_email UNIQUE (email),
    CONSTRAINT uq_auth_user_operator UNIQUE (operator_id),
    CONSTRAINT fk_auth_user_inviter FOREIGN KEY (invited_by_user_id) REFERENCES auth_user (id),
    CONSTRAINT fk_auth_user_operator FOREIGN KEY (operator_id) REFERENCES operator (id),
    CONSTRAINT ck_auth_user_role CHECK (role IN ('admin', 'member'))
);

CREATE TABLE auth_login_challenge (
    email VARCHAR(254) NOT NULL,
    code_hash CHAR(64) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_sent_at TIMESTAMP NOT NULL,
    window_started_at TIMESTAMP NOT NULL,
    send_count INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT pk_auth_login_challenge PRIMARY KEY (email)
);

CREATE TABLE auth_session (
    id CHAR(36) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    user_id CHAR(36) NOT NULL,
    device_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    last_seen_at TIMESTAMP NOT NULL,
    absolute_expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP NULL,
    CONSTRAINT pk_auth_session PRIMARY KEY (id),
    CONSTRAINT uq_auth_session_token UNIQUE (token_hash),
    CONSTRAINT fk_auth_session_user FOREIGN KEY (user_id) REFERENCES auth_user (id)
);
CREATE INDEX ix_auth_session_user ON auth_session (user_id, last_seen_at);

CREATE TABLE auth_device_sync (
    user_id CHAR(36) NOT NULL,
    device_id VARCHAR(64) NOT NULL,
    pending_count INTEGER NOT NULL,
    last_reported_at TIMESTAMP NOT NULL,
    CONSTRAINT pk_auth_device_sync PRIMARY KEY (user_id, device_id),
    CONSTRAINT fk_auth_device_sync_user FOREIGN KEY (user_id) REFERENCES auth_user (id),
    CONSTRAINT ck_auth_device_sync_count CHECK (pending_count >= 0)
);

CREATE TABLE auth_setting (
    setting_key VARCHAR(64) NOT NULL,
    setting_value VARCHAR(254) NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    updated_by_user_id CHAR(36) NOT NULL,
    CONSTRAINT pk_auth_setting PRIMARY KEY (setting_key),
    CONSTRAINT fk_auth_setting_actor FOREIGN KEY (updated_by_user_id) REFERENCES auth_user (id)
);

ALTER TABLE audit_log ADD COLUMN actor_user_id CHAR(36) NULL;
ALTER TABLE audit_log ADD COLUMN actor_email VARCHAR(254) NULL;
ALTER TABLE audit_log ADD CONSTRAINT fk_audit_actor_user FOREIGN KEY (actor_user_id) REFERENCES auth_user (id);
CREATE INDEX ix_audit_actor ON audit_log (actor_user_id, occurred_at);
