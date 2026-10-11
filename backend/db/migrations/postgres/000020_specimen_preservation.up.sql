-- Storage temperature does not tell us whether source material was fresh or
-- cryopreserved at collection. Preserve the uncertainty explicitly.
ALTER TABLE specimen ADD COLUMN preservation_state VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE specimen ADD CONSTRAINT ck_specimen_preservation_state
    CHECK (preservation_state IN ('FRESH', 'CRYOPRESERVED', 'UNKNOWN'));
