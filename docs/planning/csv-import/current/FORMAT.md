# Import workbook contract — version 4

Internal implementation contract. Customer instructions are in the v4 DOCX/PDF.
Production work is tracked in ../improve-plan.md. These artifacts do not implement the importer.

## Files and scope

- experiment-template-final.xlsx: ข้อมูลการทดลอง, ผลเอ็มบริโอ, ตัวอย่าง
- registry-template-final.xlsx: ทะเบียนปลา, ตัวอย่างที่เก็บ, ตัวอย่าง
- Custom properties: template_version=4, template_kind=experiment or registry.
- The final filename suffix is a delivery label; the internal schema version remains 4.
- Import only the two input sheets. Never import ตัวอย่าง.
- QC / NBD / IVF aggregate results are outside v4. No QC table, mapping, preview,
  or write step. Keep backend APIs, tables and stored QC data; do not restore QC UI.
- Treatment-group names such as Control remain valid and are not QC count records.
- Reject unsupported versions/sections rather than guessing an old layout.

## Experiment workbook

Shared fields: B5 sequence, E5 experiment_date, H5 site, B6 operator,
E6 treatment_group, H6 source_version. All start blank. V1/V2 describes source data,
not the template version.

| Table | Range with canonical header | Input rows |
|---|---|---|
| Lots | A12:N62 | 13–62 (50 rows) |
| Aggregate | A67:AQ117 | 68–117 (50 rows) |

Display headers: rows 11/66. Canonical rows 12/67 are hidden. Three data rows per table
are visible initially; expand outline groups for the remaining rows. Parse hidden rows.
Use native Table ranges when extended, not fixed end-row assumptions.

Lots columns: lot_no, batch_code, activated_at, donor_strain, donor_preparation,
donor_derivation, donor_batch_code, n_activated, notes, batch_code_to_use,
recipient_egg_source, csof_lot_source, egg_code_source, injection_source.

lot_no is a unique positive integer within the experiment. activated_at is time zero.
The last four fields preserve Recipient egg, Lot of CSOF, Code of Egg and Injection
as optional original values. Do not fabricate master IDs or concatenate these into notes.
The blue helper can generate a reference when the original code is missing; freeze the
chosen code as a value before first submission and keep it for subsequent corrections.

Aggregate columns: lot_no, source_label, n_activated, 36 stage counts from 1C through
15D, Fry, Juvenile, Adult, notes. Counts are nonnegative integers, blank means missing.
Use aggregate records only for lot/period data lacking individual records. Never create
individual embryos from counts or double-count overlapping series. Lot references must
resolve to Lots, independently of Excel validation.

Embryo sheet: display header row 6, canonical row 7; 400 four-row blocks, rows 8–1607.
Roles OUTCOME / TIME / CONDITION / OBSERVER. Only OUTCOME owns metadata.
A:L: lot_no, seq_in_lot, embryo_code, embryo_code_to_use, well_position, record_type,
observer_default, observation_date, exit_stage, exit_reason, exit_at, remarks.
M:AL: 26 standard stages from 1C through 5D in the client-confirmed order.

Embryo outcome 0/ALIVE=alive, 1/DEAD=dead. TIME is actual time or datetime, using
observation_date for time-only values. Use the recorded datetime for overnight checks.
CONDITION uses NORMAL/ABNORMAL/UNDETERMINED. OBSERVER overrides the explicit
same-observer default for each stage. Missing both requires review, not the uploader name.
well_position accepts A1–H12. exit_stage is the last recorded alive stage, not an age estimate.
Exit reasons: DEAD, DEGENERATED, PROMOTED, LOST. Preserve actual exit date/time.

## Registry workbook

Fish sheet: display header row 7, canonical row 8; 200 four-row blocks, rows 9–808.
Roles OUTCOME / CONDITION / DATE / OBSERVER. Metadata and specimen codes belong only
to OUTCOME. Flag data in the wrong role rather than silently discarding it.

A:U: fish_code, fish_code_to_use, embryo_code, dob, donor_strain, donor_preparation,
donor_derivation, donor_batch_code, status, biological_condition, first_abnormal_on,
sex, site, fish_box, fin_clipped, exit_date, exit_reason, action, remarks, record_type,
observer_default.

V:Y: cl_specimen_code, rt_specimen_code, dc_specimen_code, cla_specimen_code.
Z:OE: d1–d370. DATE holds actual integral Excel calendar dates in Thailand; never infer
the date from DOB or the d column. OBSERVER overrides the explicit same-observer default.
Daily outcome is 1/ALIVE=alive, 0/DEAD=dead.

DOB means experiment date; missing is allowed only if resolvable from linked embryo data.
Latest and daily biological-condition text preserves original wording (max 500 characters).
Review mapping to the DB enum explicitly; do not infer that old/weak/ill/deformed equals
ABNORMAL. first_abnormal_on is the first abnormal date, used only when latest classification
is explicitly ABNORMAL. DEAD requires exit_date; missing historical dates remain review
items, not fabricated DOB/freezing/submission dates.

Sex: M/F/ND, retaining source ND alongside ND→UNKNOWN conversion. fin_clipped:
Y→true, N→false, blank→unknown. Site KU/MSU. Fish exit pairs: INTACT/FROZEN,
DEGENERATED/DISCARDED, LOST/DISCARDED. The server validates final dates and pairs.

### Specimen register and references

One table Specimens: A7:C207, 200 blank data rows starting at row 8.
Display row 6: No, CODE, Specimen type. Hidden row 7: no, specimen_code, specimen_type.
There is no Links table or source/date/storage form.

- No: optional positive-integer ordering, not an entity key or fish reference.
- CODE: original unique specimen code; infer CL/RT/DC/CLA from prefix, matching
  CLA before CL. Require a nonempty suffix. Preserve original spelling.
- Specimen type: required with CODE. Values: Whole embryo, Whole Adult Fish,
  Caudal fin clip, Anal fin clip, Donor cells, left over cells. Define backend enum mapping.
- Resolve fish CL/RT/DC/CLA to a matching-group CODE in this register or existing data
  confirmed during dry-run. Blank references are allowed.
- CL/CLA are samples from the clone fish. RT is a sample from the related egg recipient;
  DC is a related donor-cell sample. RT/DC may be shared across fish. Do not fabricate
  donor/recipient IDs or claim RT/DC tissue was collected from the clone fish.
- There is one cell per group per fish. Multiple codes of one group per fish are outside
  this format; do not silently accept comma-separated lists.
- Create one specimen per CODE and one relationship per pair. Retain and flag unlinked
  specimens without inventing fish. Missing optional columns do not clear existing data.

## Import safeguards and corrections

Keep source operator/group names and codes. Flag potentially equivalent names during
dry-run instead of merging automatically. Legacy import is the confirmed fallback for
unknown experiment operators, not an invented observer.

Reject demonstration identifiers containing EXAMPLE or CLIENT_ at all entity/reference
boundaries, including CL_EXAMPLE_01, even if Excel validation was bypassed.

Blank observations mean no record, not death or clearing. Do not synthesize NOT_OBSERVED.
Add/update/skip/diff/explicit-clear behavior requires implementation and review. Reuploads
keep stable keys. Omitted rows and empty cells do not delete records or relationships.
Clear requests need an explicit field and reason. Keep transactions and audit. Avoid double
counting at PROMOTED embryo-to-fish handoff.

Excel formulas, validation and formatting are entry aids. The importer independently
validates the whole submission, including pasted data and extended rows. Customer
instructions are standalone; FORMAT.md and improve-plan.md are internal team documents.
