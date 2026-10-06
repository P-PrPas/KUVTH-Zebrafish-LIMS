-- ===========================================================================
-- GENERATED FILE — do not edit by hand.
-- Source: backend/db/migrations/postgres/000017_import_reuse_codes.up.sql
-- Regenerate: python3 scripts/gen_mysql_migrations.py
-- ===========================================================================

-- A reverted import keeps its soft-deleted rows for audit, while a corrected
-- upload may reuse the same visible fish/specimen code.
ALTER TABLE clone_fish DROP INDEX uq_clone_fish_code;
ALTER TABLE clone_fish ADD COLUMN live_code_marker CHAR(36) GENERATED ALWAYS AS (
    CASE WHEN deleted_at IS NULL THEN '0' ELSE id END
) STORED;
ALTER TABLE clone_fish ADD CONSTRAINT uq_clone_fish_live_code
    UNIQUE (fish_code_norm, live_code_marker);

ALTER TABLE specimen DROP INDEX uq_specimen_code;
ALTER TABLE specimen ADD COLUMN live_code_marker CHAR(36) GENERATED ALWAYS AS (
    CASE WHEN deleted_at IS NULL THEN '0' ELSE id END
) STORED;
ALTER TABLE specimen ADD CONSTRAINT uq_specimen_live_code
    UNIQUE (specimen_code_norm, live_code_marker);
