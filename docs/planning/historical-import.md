# Historical import: agreed behavior and delivery map

This document records the requirements agreed for the launch migration. The
customer's mapping response and example workbook are local research inputs; the
importer must not depend on those files being present in a deployed image.

## Inputs and access

- Only an admin can create, edit, bypass, confirm, revert, or download an import.
- One job accepts either one XLSX workbook or a set of CSV files. Each CSV
  represents one source sheet. The admin selects which XLSX sheets or CSV files
  to process; unrelated sheets are retained in the original upload but ignored.
- The first supported layouts are the V1/V2 raw, fish, specimen, QC, and dated
  experiment sheets in the customer example. Unknown sheets and columns must be
  shown in review, never silently dropped. The admin can map compatible sheets
  or explicitly ignore them with a reason.
- CSV decoding offers a preview and an admin-selectable encoding. XLSX formulas
  use the cached displayed value; an absent cached value is an issue.
- Jobs remain available after launch. The original bytes are retained for
  admin-only inspection, alongside immutable source values and later decisions.

## Review and commit

The upload creates a durable draft. Parsing produces logical `import_record`
items with source coordinates. Each record keeps immutable `source_json` and a
separate editable `working_json`. Issues name the file, sheet, row, column,
source value, and rule. Admin edits and decisions are audited.

`warning` issues explain a limitation but permit confirmation. An `overridable`
issue can be bypassed only with a reason and user identity; bulk bypass is
allowed when the rule and reason are shared. A `blocking` issue cannot enter
the canonical data model. The original upload remains in draft while blocking
issues exist. Confirmation writes the selected normalized records atomically.
No partial canonical commit or silent row skipping is allowed.

Duplicates across sheets, jobs, input formats, and existing records are matched
by domain identity, not only file hashes or row positions. Conflicting values
are shown side by side for admin resolution. Re-uploading a corrected file shows
differences before changing prior records. A whole-job revert is available when
it cannot erase later dependent work; otherwise the admin uses corrections.

## Historical meaning

- Import the full history supported by the source, including experiments,
  embryos, observations, fish, QC, and specimens. Derived summary sheets are
  reconciliation inputs, not new observations.
- Source V2 embryo and fish stage cells use `1 = alive`, `0 = not surviving`.
  A Degenerated marker distinguishes `DEGENERATED` from `DEAD`. A fish `0`
  after a recorded freeze or discard means tracking ended, not death.
- `d1`/`Day 1` means DOB plus one day. The source may hold hundreds of daily
  fish entries. A last known `1` does not establish present-day `ALIVE` status.
- Biological life state and disposition (frozen, discarded, lost) are separate.
  Unknown death or disposition dates remain unknown; do not invent dates.
- Unknown preparation, biological condition, current fish status, and exact
  observation time remain explicit unknowns. Date-only observations are kept
  but excluded from hour-post-activation and timing-deviation calculations.
- V1 and MSU SCNT stage counts without individual identities remain aggregate
  counts. Never fabricate embryos from totals. Aggregate and individual series
  are labeled separately in reports and must not be added when they may overlap.
- Preserve raw QC fractions, percentages, notes, and IVF before/after phase.
  Parse structured values only when unambiguous.
- Stages outside the current 36-stage protocol remain labeled historical data
  and are excluded from protocol-specific timing charts until mapped.
- `CL`, `RT`, `DC`, and `CLA` specimens and the actual source material types
  must be representable without assigning recipient or donor material to an
  arbitrary clone fish. The same source specimen may relate to several clones.
- Generated batch codes exclude lot number. Legacy V1 fish codes remain the
  visible codes; V2 codes are generated when absent. System-wide fish running
  numbers are new; source numbers remain searchable provenance.
- Time values use the experiment site's local time zone before UTC storage.
  The admin can correct the site/time zone when the source is wrong.
- Existing donor preservation data represent Fresh/Cryopreserved. The live
  capture UI must expose this field. Unknown V2 cell preparation is not guessed.
- The system proposes master-data mappings, including new treatment groups and
  operator labels. Genuinely unknown operators use a `Legacy import` operator
  while preserving the source text; this does not create a login account.

## Deferred source fields

Every meaningful column without a canonical destination goes to
`import_unmapped_field`. The admin sees pending counts and values. Once a later
release adds a target field, the admin can map the source column, preview all
proposed values and conflicts, then apply a batch backfill without re-uploading
the source. Backfill is idempotent and audited.

## PR sequence

1. Durable schema and provenance (this PR).
2. XLSX/CSV parsers, reconciliation, mapping, and import APIs.
3. Admin review UI, edits, bypass, confirmation, revert, and deferred-field
   backfill.
4. Historical views, dashboards, exports, and badges for limited source data.

The feature is complete when these slices work together. The first PR only
adds storage and does not enable the import workflow.
