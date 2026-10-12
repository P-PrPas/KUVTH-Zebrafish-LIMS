-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000013_correction_requests.down.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

DROP TABLE correction_request;
DELETE FROM request_idempotency WHERE operator_id IS NULL;
ALTER TABLE request_idempotency MODIFY operator_id CHAR(36) NOT NULL;
