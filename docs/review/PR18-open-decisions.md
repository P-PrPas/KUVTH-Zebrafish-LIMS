# PR #18 — PDF decisions still open

Source: `docs/feedback/[Rev1]20260916_KUVTH_Zebrafish_LIMS_UI.pdf`

Last reviewed: 2026-10-04

This note separates decisions that still need an answer from feedback already answered or explicitly deferred. Page numbers below are the PDF's physical page numbers.

## Awaiting a decision

### PDF p. 19–20 — Gaps in automatically generated Injection Lot numbers

The PDF asks whether the system should generate the lot number automatically or let the user enter it (p. 19), and notes that multiple lots can be created in one day (p. 20). The decision to generate numbers automatically, separately by experiment and day, has already been confirmed. The current allocation scope also uses the Code of Egg; numbers are not guaranteed to be gap-free when a number has already been reserved or allocated.

**Decision needed:** Are gaps acceptable, with allocated numbers left unchanged, or must finalized lots have consecutive numbers? If consecutive numbers are required, please also confirm whether unused reservations may be reclaimed or whether the numbering should instead be allocated only when a lot is finalized. Renumbering existing lots is not assumed.

### PDF p. 21–22 — Meaning of “Number of manipulated embryos”

The PDF labels a field **“Number of manipulated embryos”** and asks to place it under **Enucleation**. The current workflow treats the corresponding value as the number of embryos to add to an existing lot, so changing only the label could misrepresent what the field does.

**Decision needed:** Should this field record the total number of manipulated embryos for the lot (and be labelled/positioned accordingly), or should it remain an incremental “number of embryos to add” field? If both values are needed, confirm that a separate total field should be added.

### PDF p. 23 — Meaning of “Pick up”

The Injection Lot form labels the timestamp **“Process start (Pick up)”**. The current Thai translation says **“เวลาเริ่มกระบวนการ (รับปลา)”**, but “Pick up” may refer to receiving eggs or embryos rather than fish.

**Decision needed:** Which event does this timestamp represent—egg collection/receipt or embryo pickup/receipt? Confirm the preferred Thai wording. The stored timestamp behavior is unchanged until this is clarified.

## Answered or deferred — not open for this PR

- **PDF p. 4 — Ranking count:** Confirmed by the user: show every result matching the active filters; do not impose a fixed top-N limit. Keep experiment group and other existing filters usable.
- **PDF p. 19 — Automatic numbering:** Confirmed by the user: generate numbers automatically, separately by experiment and day. The remaining question is only the gap policy above.
- **PDF p. 43 — Experiment-group Category & Choice:** The request to let users enter their own categories and choices is deferred to a separate branch, as directed by the user. It is intentionally outside PR #18 and is not a merge decision for this PR.
