CREATE TABLE auth_user (
    id CHAR(36) NOT NULL,
    email VARCHAR(254) NOT NULL,
    role VARCHAR(10) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    verified_at DATETIME(3) NULL,
    invited_at DATETIME(3) NOT NULL,
    invited_by_user_id CHAR(36) NULL,
    operator_id CHAR(36) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    CONSTRAINT pk_auth_user PRIMARY KEY (id),
    CONSTRAINT uq_auth_user_email UNIQUE (email),
    CONSTRAINT uq_auth_user_operator UNIQUE (operator_id),
    CONSTRAINT fk_auth_user_inviter FOREIGN KEY (invited_by_user_id) REFERENCES auth_user (id),
    CONSTRAINT fk_auth_user_operator FOREIGN KEY (operator_id) REFERENCES operator (id),
    CONSTRAINT ck_auth_user_role CHECK (role IN ('admin', 'member'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE auth_login_challenge (
    email VARCHAR(254) NOT NULL,
    code_hash CHAR(64) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    last_sent_at DATETIME(3) NOT NULL,
    window_started_at DATETIME(3) NOT NULL,
    send_count INT NOT NULL DEFAULT 1,
    CONSTRAINT pk_auth_login_challenge PRIMARY KEY (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE auth_session (
    id CHAR(36) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    user_id CHAR(36) NOT NULL,
    device_id VARCHAR(64) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    last_seen_at DATETIME(3) NOT NULL,
    absolute_expires_at DATETIME(3) NOT NULL,
    revoked_at DATETIME(3) NULL,
    CONSTRAINT pk_auth_session PRIMARY KEY (id),
    CONSTRAINT uq_auth_session_token UNIQUE (token_hash),
    CONSTRAINT fk_auth_session_user FOREIGN KEY (user_id) REFERENCES auth_user (id),
    INDEX ix_auth_session_user (user_id, last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE auth_device_sync (
    user_id CHAR(36) NOT NULL,
    device_id VARCHAR(64) NOT NULL,
    pending_count INT NOT NULL,
    last_reported_at DATETIME(3) NOT NULL,
    CONSTRAINT pk_auth_device_sync PRIMARY KEY (user_id, device_id),
    CONSTRAINT fk_auth_device_sync_user FOREIGN KEY (user_id) REFERENCES auth_user (id),
    CONSTRAINT ck_auth_device_sync_count CHECK (pending_count >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE auth_setting (
    setting_key VARCHAR(64) NOT NULL,
    setting_value VARCHAR(254) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    updated_by_user_id CHAR(36) NOT NULL,
    CONSTRAINT pk_auth_setting PRIMARY KEY (setting_key),
    CONSTRAINT fk_auth_setting_actor FOREIGN KEY (updated_by_user_id) REFERENCES auth_user (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE audit_log ADD COLUMN actor_user_id CHAR(36) NULL;
ALTER TABLE audit_log ADD COLUMN actor_email VARCHAR(254) NULL;
ALTER TABLE audit_log ADD CONSTRAINT fk_audit_actor_user FOREIGN KEY (actor_user_id) REFERENCES auth_user (id);
CREATE INDEX ix_audit_actor ON audit_log (actor_user_id, occurred_at);
