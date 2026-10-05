ALTER TABLE request_idempotency ALTER COLUMN operator_id DROP NOT NULL;

CREATE TABLE correction_request (
    id CHAR(36) NOT NULL PRIMARY KEY,
    requester_id CHAR(36) NOT NULL,
    requester_email VARCHAR(254) NOT NULL,
    recorded_operator_id CHAR(36) NULL,
    recorded_by_user_id CHAR(36) NULL,
    target_table VARCHAR(40) NOT NULL,
    target_id CHAR(36) NOT NULL,
    field_name VARCHAR(64) NOT NULL,
    old_value TEXT NOT NULL,
    proposed_value TEXT NOT NULL,
    source_updated_at VARCHAR(40) NOT NULL,
    reason VARCHAR(2000) NOT NULL,
    status VARCHAR(20) NOT NULL,
    decision_reason VARCHAR(2000) NULL,
    decided_by_user_id CHAR(36) NULL,
    applied_audit_id CHAR(36) NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT ck_correction_status CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
    CONSTRAINT fk_correction_requester FOREIGN KEY (requester_id) REFERENCES auth_user(id),
    CONSTRAINT fk_correction_decider FOREIGN KEY (decided_by_user_id) REFERENCES auth_user(id)
);
CREATE INDEX ix_correction_status_created ON correction_request (status, created_at);
CREATE INDEX ix_correction_target ON correction_request (target_table, target_id);
CREATE INDEX ix_correction_requester ON correction_request (requester_id, created_at);
