# KUVACB research workspace

## Direction

Reference: [Kasetsart University Veterinary Animal Cell Bank](https://kuvacb.com/).
Use the supplied, unmodified KUVACB logo and laboratory illustration. The application
is a working research notebook: clear tasks and legible records take priority over
marketing decoration. The banner belongs on the results overview; data-entry pages
start with the task itself.

## Foundations

Implementation source of truth: `frontend/src/styles.css`.

| Role | Token | Color |
| --- | --- | --- |
| Primary actions | `--primary` | `#006664` |
| Active navigation | `--brand-lime` | `#b0bd35` |
| Navigation background | `--sidebar` | `#073f3d` |
| Main text | `--ink` | `#173d3b` |
| Secondary text | `--muted` | `#526a67` |
| Canvas | `--canvas` | `#f4f6f2` |
| Attention / waiting | `--accent` | `#8b601b` |
| Errors / overdue | `--danger` | `#a13636` |
| Supporting information | `--info` | `#235b81` |

- Keep the existing locally hosted Plex Thai family and tabular numerals.
- Body, form labels, inputs, and data-table values use at least 16px; supporting
  copy generally uses 14px. Small chart and plate annotations are supplemented by
  detailed records or the selected-well editor.
- Use 8px spacing increments, 48px standard inputs, and visible keyboard focus.
- Lime carries dark text. Never use it for small text against white.
- Pair each state color with a readable label or symbol. Status and selection are
  separate: saved, dead, and exception states retain their meaning when selected.
- Use the existing shared SVG icons. No new icon, chart, or animation dependency.

## Workflow rules

- Keep daily tasks visible and group reference settings separately.
- The overview provides shortcuts to embryo checks, experiments, and fish care.
- Experiment search matches code or date within the currently loaded/filter-scoped
  list, without changing the server query or hiding the matching-record count.
- Use numbered fieldsets for experiment identity and responsibility/protocol;
  keep optional sample/environment inputs in a native disclosure.
- Preserve operator gating, native validation, error summaries, queued writes,
  audit behavior, and scientific calculation semantics.
- Wide screens show navigation beside content. Narrow screens use the existing
  labelled navigation and More disclosure; forms stack into one column.
- Tables may scroll inside their labelled region. The page itself must not overflow.
- Honor reduced-motion preferences and reserve scroll clearance for the checkpoint
  confirmation bar. Print views omit navigation and decorative overview content.

## Verification

`npm run check` validates formatting, types, and production build. `npm test` includes
regressions for experiment search and contrast of brand/status token pairs. Browser
validation uses isolated development data, not production records. Token contrast
checks are not a substitute for a complete assistive-technology accessibility audit.
