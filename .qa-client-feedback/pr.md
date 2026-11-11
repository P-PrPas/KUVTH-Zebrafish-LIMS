## Summary

Implements the four client feedback items following the UI redesign: a clean analysis workbook matching the supplied Excel example, parent groups above experiments, persistent observation drafts with confirmation reminders and last-well restoration, and clearer grey unassigned wells.

Researchers can now resume an interrupted observation session on the same device without re-entering draft values, organize multiple experiments under one research group, and download the client's 30-column analysis layout.

## Changes

### Clean Excel export

- Adds a prominent **Clean Excel** export with a single `v4` worksheet and exactly the 30 headers/order in `docs/examples/example_data/Experiment_Cloning_03_Clean table v1.xlsx`.
- Maps actual stage orders to the client's labels. Omits 128-cell, Day2 and Day5 instead of shifting those observations into another column. Exports numeric replicate values and counts, with a frozen header and auto-filter.
- Preserves the existing detailed 14-sheet workbook, optional sheet selection, and legacy R CSV for existing integrations. The API defaults to the detailed workbook unless `format: "clean"` is specified.
- Accepts all shared analytics filters, including the new parent experiment group.

**Scientific counting rule:** the supplied requirements describe Fry/Juvenile/Adult as age-based stages but do not define age boundaries. The UI therefore asks for the study's three increasing age milestones rather than assuming biological cutoffs. A fish is counted once when a non-deleted ALIVE observation documents that age or a later age. Current age alone is insufficient, and manual fish without experiment lineage are excluded. Zero means no documented survivors at that milestone, not necessarily confirmed mortality. The chosen ages appear in the filename. Separate projects sharing site/strain/replicate identifiers should be filtered by parent group before export.

### Parent experiment groups

- Adds `experiment_group` with code, name, description, active state and row version; codes are unique case-insensitively.
- Adds an optional indexed `experiment_batch.experiment_group_id` foreign key. One parent group contains many experiments; each experiment has at most one parent. Treatment groups remain a separate concept.
- Provides master-data creation/editing/inactivation, experiment assignment/reassignment, list filtering and shared analytics/export filtering. New experiments inherit the selected active group; duplicated experiments retain their parent.
- Existing experiments remain ungrouped until assigned explicitly. Inactive groups remain available in historical filters while new assignments require an active group.

### Observation drafts and resuming work

- Persists stages, outcomes, conditions, notes and selected well as edits occur, scoped to the current operator and lot on the same browser/device.
- Reopens the last lot and well when returning to the observation page, with an explicit **draft / not confirmed** reminder. Draft persistence does not submit observations.
- Reconciles restored drafts with authoritative checkpoint records and pending offline writes. Already saved entries are not submitted again; pending entries stay locked; rejected entries can be edited.
- Handles a queue completion during initial loading by refreshing the checkpoint before displaying editable values.
- Shows cached drafts with a warning when the server is unavailable, reports local-storage failures, and requests a browser unload warning for unconfirmed entries. Persistence does not depend on unload events, which are unreliable when suspending an iPad.
- Returning explicitly to the lot list retains unfinished entries and the last selected well, while clearing confirmed stages for the next observation round.

### Follow-up: safer observation completion and representative seed data

- Seeds `SCNT_CLONING` in PostgreSQL, MySQL and the in-memory development state. PostgreSQL demo batches belong to that group, and the demo invariant verifies the relationship.
- Leaves **Outcome** blank for a new observation. Applying a stage in bulk keeps the work as a draft; final confirmation stays disabled until the researcher explicitly records **Alive** or **Dead** for each well to submit.
- Makes draft state persistent in the workspace with an auto-save indicator, stored save time and an explicit **Save draft now** action. Draft values remain local until final confirmation.
- Simplifies normal well cards to the well ID and a state marker. The full embryo identifier remains in the selected-well panel and the accessible card label.
- Uses amber for an alive well marked abnormal; a recorded dead outcome takes precedence and remains red, including before confirmation.

### Unassigned wells

- Uses a grey surface and short embryo number/status symbol instead of repeating the full code.
- Retains the full identifier in the selected-well panel and accessible labels, preserves the selected outline, and sorts numeric identifiers naturally (2 before 10).

## Database rollout and rollback

- Includes PostgreSQL migration `000010_experiment_groups` and the generated MySQL equivalent, with both up/down scripts.
- Deploy the backend and apply its startup migration before releasing the frontend. The migration is additive and does not rewrite existing experiments or observations.
- Roll back the application before rolling back the schema. The down migration removes group records and assignments: back up/export them first. Experiment and observation records are retained.
- Adds no runtime dependencies and uses the existing master API, snapshot store, offline queue and XLSX writer.

## Validation

- [Pull request CI run](https://github.com/P-PrPas/KUVTH-Zebrafish-LIMS/actions/runs/34437085695): **all four jobs passed** (`app`, `contract`, `postgres`, `mysql`), including production images and both Compose proxy smoke tests.
- Backend suite: **186 passed**, with the five database integration tests skipped in the memory run; domain/services coverage **93.75%**.
- PostgreSQL 16 integration: **5 passed**, including group persistence across store instances, copied experiment associations, and filtered queries.
- Frontend: **152 passed**; line coverage **87.51%**, branch coverage **78.62%**. Production build, TypeScript and Biome checks pass.
- Follow-up: production build, TypeScript and Biome checks pass; **15** observation-workflow tests, **27** domain/group backend tests, Ruff and OpenAPI validation pass.
- Regression checks cover reference-workbook headers, actual stage mapping, milestone counts/deduplication, invalid age criteria, group assignment validation, draft restoration, pending/saved/rejected/offline reconciliation, and download parameters.
- Chromium with touch/iPad emulation and an isolated real memory API: draft reload restored lot/well/stage/notes; save then reload prevented duplicate submission; parent filtering and actual clean XLSX download passed with no JavaScript errors.
- Export layout checked for horizontal overflow at 768×1024, 820×1180, 1024×768, 1180×820, 1366×1024, 390×844 and 1440×1000. This is emulation, not a physical Safari/iPad certification.
- Ruff formatting/lint, OpenAPI validation (54 paths / 74 operations), source encoding, generated API types, generated MySQL migrations and `git diff --check` pass.

## Review / acceptance

1. Create a parent group in Master data; assign and filter experiments. Confirm existing ungrouped records remain accessible.
2. Open a lot on an iPad-sized viewport, choose a stage and outcome for a well, reload, and verify the same selection and values return without submission. Verify a bulk stage alone cannot enable final confirmation.
3. Confirm, reload and verify the entry is saved. Repeat offline and verify pending writes remain locked until resolved.
4. Inspect unassigned wells for grey styling, concise labels, numeric order and a clear selection outline.
5. Export Clean Excel using the study's age milestones and compare the header/order with the reference workbook. Confirm legacy exports still work.

Drafts are local to this browser/device and are removed when browser data is cleared; a fresh session may require selecting the same operator again. Operational details and counting rules are documented in `docs/guides/client-feedback-workflows.md`.
