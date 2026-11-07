# Customer v5 import

The two workbooks in `docs/planning/csv-import/v5` define the customer contract.
The same original bytes are packaged under
`backend/src/chronofish/services/templates` for production downloads.

1. Create the referenced sites (including time zones), operators, donor cell
   lines, treatment groups when known, and fish boxes in master data first.
2. Download **experiment v5** or **registry v5** from the import page.
3. Upload one XLSX at a time. Import experiments before a registry that refers
   to their embryos. Select the data sheets; the example sheet is never selected
   automatically.
4. Review the source blocks, run **Validate all records**, then confirm the
   complete job. Validation makes no canonical writes. Confirmation runs in a
   single transaction, including aggregate counts and shared specimen links.

## Mapping

| Form section | Canonical destination |
| --- | --- |
| Experiment metadata and activation lots | Experiment batches and injection lots |
| Embryo four-row blocks | Explicit embryos and observations for populated stages |
| Aggregate rows | Historical stage counts, separate from operational timing data |
| Fish four-row blocks | Fish registrations and observations on actual recorded dates |
| Specimen registry and CL/RT/DC/CLA columns | Specimens and fish links; RT/DC may be shared |

Blank results remain absent. `1`/`ALIVE` and `0`/`DEAD` have the same meaning in
both forms. Native Excel dates and times are supported. Time-only embryo
observations require `observation_date`; fish day-column labels never substitute
for actual observation dates. Local embryo timestamps use the experiment site's
time zone.

For time-only embryo entries, a deviation of more than 12 hours from the stage's
expected timing blocks confirmation and requires the full date and time. This
rejects implausible day 1–5 timestamps instead of silently guessing a different date.
Known health/condition labels ignore case and surrounding spaces; `Abnormal`
and `abnormal` retain the same permanent-disability evidence as `ABNORMAL`.

Lots represented by aggregate rows are stored only in the historical tables.
They do not create operational batches/injection lots and do not enter dashboard
or R-export denominators for individually tracked embryos. Showing aggregate
series on the operational dashboard would require a separate product decision.

Reference formulas are compared with the distributed v5 formulas, never
executed. Reference codes are recomputed from the input cells, so missing Excel
formula caches do not create phantom rows or block otherwise valid uploads.
Other formulas and edited headers block confirmation. Copied four-row blocks
and inserted activation-lot rows are supported within the existing upload limits.

Unknown historical treatment may remain empty when explicit codes are provided.
Incomplete required facts block confirmation with source-row context; they do
not cause partial writes or guessed scientific values. Repeated codes are
rejected for manual reconciliation; an upload never silently overwrites an
existing registration.

Recorded fish life state and disposition remain separate: `DEAD` + `INTACT` +
`FROZEN` maps to operational status `FROZEN`, life state `DEAD`, disposition
`FROZEN`. Original exit condition and free-text health remain in remarks/source
evidence. Recognized health labels populate health status and disability fields;
unknown text remains available without inferring disability.

CL/CLA identify one clone's sample. RT/DC can link to multiple fish. Every
reference must resolve to the uploaded specimen registry or an existing active
specimen of the matching kind. Specimen type `Donor cells` maps to the existing
`LEFTOVER_CELLS` category, with the exact original type retained in notes.

## Deployment and limits

Migration 27 widens experiment and specimen codes to 150 characters and permits
unknown treatment groups. PostgreSQL and generated MySQL migrations are included.
Rollback refuses incompatible long codes or unknown treatment values instead of
truncating or inventing data. PostgreSQL migrations are transactional; follow
the existing backup procedure before MySQL schema changes.
Once such v5 data exists, migration 27 cannot be rolled back as-is: restore a
compatible backup or explicitly reconcile those records before downgrading.

Historical aggregate confirmation needs the configured SQL database. The legacy
CSV/XLSX paths and the internal canonical schema importer remain available.
Automatic correction/upsert of existing codes is outside this change. The
existing revert endpoint does not support v5 experiment graphs or registry jobs
with operational observations; it rejects these jobs before deleting data.
