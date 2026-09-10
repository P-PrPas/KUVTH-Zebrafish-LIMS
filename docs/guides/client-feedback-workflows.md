# Client feedback: experiment groups, observation drafts and clean export

## Experiment groups

Create a **กลุ่มงานทดลอง / Experiment group** in Master data, then select it when creating or editing an experiment. One group contains many experiments; an experiment belongs to at most one group. This is separate from the existing treatment group (SCNT, IVF, etc.). Existing experiments remain ungrouped until assigned explicitly.

Groups have a unique, case-insensitive code, name and optional description. Inactive groups remain attached to historical experiments but cannot be assigned to new experiments. Experiment lists, due work, fish lists, analytics and exports accept `experimentGroupId`.

Migration `000010_experiment_groups` adds `experiment_group`, the nullable `experiment_batch.experiment_group_id` foreign key, and an index. Both PostgreSQL and generated MySQL migrations are included. Deploy the backend migration before the new frontend. No existing observations are rewritten or deleted. Normal server startup applies pending migrations.

Rollback: deploy the previous frontend/backend first. The down migration removes group assignments and the group table, so export/back up those records before running it. Existing experiments and observations remain intact.

## Drafts on the observation page

Stage, outcome, condition, notes and selected well are saved to local storage as the researcher edits. Returning to the observation page restores the same lot and well for the same operator on the same browser/device. The draft notice explicitly says the observations have **not yet been confirmed**. Confirmation sends the selected observations through the existing offline queue and audit workflow; navigating away does not submit a draft.

On reopening, the page reconciles the draft against the latest checkpoint and pending queue. Already recorded observations are not offered as new submissions; queued observations stay locked until their request completes. If the checkpoint cannot be fetched, the cached draft is shown with a warning. Failed local storage writes produce a visible warning. A browser unload warning is requested for unconfirmed entries, while persistence runs on every edit so it does not rely on unload events on iPad.

Returning explicitly to the lot list clears the automatic lot reopening location and retains unfinished draft entries and the selected well. Confirmed stages are cleared from that draft so the next observation round can begin. Drafts do not synchronize between devices. Clearing browser data removes them. A new browser session may require selecting the same operator again.

Unassigned wells use a grey surface, a short embryo number and status symbol. The complete embryo code remains in the selected-well panel and accessible label. Numeric sorting keeps 2 before 10.

## Clean Excel

The primary clean export produces one sheet named `v4`, with exactly the 30 headers in `docs/examples/example_data/Experiment_Cloning_03_Clean table v1.xlsx`. Rows are grouped by site, donor strain and replicate; `Replicate` and stage counts are numeric. Use the experiment group filter when separate projects reuse the same site/strain/replicate identifiers.

```text
Sites, Strain, Replicate, Strain_Rep,
Activated, 2-cell, 4-cell, 8-cell, 16-cell, 32-cell, 64-cell,
256-cell, 512-cell, 1k-cell, High, Oblong, Sphere, Dome,
30%epi, 50%epi, Germ-ring, Shield, 75%epi, 90%epi,
Day1, Day3, Day4, Fry, Juvenile, Adult
```

128-cell, Day2 and Day5 are deliberately omitted from this format. The existing checkpoint survival rules supply embryo counts; column names are mapped to their actual stage orders, not renamed by position. The header is frozen and filtering is enabled.

The requirements identify Fry, Juvenile and Adult as age-based stages but do not specify their ages. The export form therefore requires the study's three increasing age milestones in days from birth, without assumed defaults. A fish counts once at a milestone only when a non-deleted ALIVE observation documents that age or a later age. Current age alone is not evidence of survival; manual fish without experiment lineage are excluded. **Zero means no documented survivors at that milestone, not necessarily confirmed mortality.** Later death does not erase an earlier documented survival milestone. Milestone ages are included in the filename for traceability.

API example (ages are illustrative, not prescribed biological cutoffs):

```json
{
  "format": "clean",
  "fishStageAgeDays": [7, 30, 90],
  "filters": {"experimentGroupId": "<group UUID>"}
}
```

`POST /api/v1/exports/excel` without `format` retains the detailed 14-sheet workbook and its optional sheet selection for existing integrations. The legacy R CSV remains available. Clean format rejects custom sheet selection and invalid or unordered ages.

## Acceptance checks

1. Create two parent groups, assign experiments and verify group filtering in experiments, results and downloads. Existing ungrouped experiments remain accessible.
2. On an iPad-sized screen, open a lot, select a well, change stage/condition/notes, then reload. The same lot, well and draft values return without an observation POST.
3. Confirm the draft, reload, and verify the observation is already saved. Repeat while offline: pending observations must remain locked, and rejected requests must become editable.
4. Check unassigned wells remain grey, have short labels and retain a visible selected outline.
5. Export with the study's milestone ages. Compare all 30 header names and their order to the reference, and verify omitted stages do not shift Day3/Day4 counts.

Automated checks cover the actual reference workbook headers, stage/count mapping, group validation/filtering and SQL persistence, draft restoration/reconciliation, and clean download request parameters.
