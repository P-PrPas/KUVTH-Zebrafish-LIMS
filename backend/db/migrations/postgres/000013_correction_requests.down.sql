DROP TABLE correction_request;
DELETE FROM request_idempotency WHERE operator_id IS NULL;
ALTER TABLE request_idempotency ALTER COLUMN operator_id SET NOT NULL;
