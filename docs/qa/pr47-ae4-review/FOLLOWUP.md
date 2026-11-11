# Follow-up to QA-PR47-ae4b4b7

## UI-01 — fixed

The responsive navigation uses a five-column grid below 1200px. The reminder was
an additional grid item occupying one narrow column, so its bird and text crowded
the first navigation button and pushed More onto another row.

The reminder now spans all columns at the same breakpoint, with its own row above
the navigation buttons. Its text container may shrink/wrap, numeric badges retain
their width, and long reminder actions may wrap. The expanded panel stays in normal
document flow, pushing navigation down rather than covering it. Desktop placement
and the existing reminder data/actions remain unchanged.

## Verification

- `npm run check`: Biome, TypeScript and production build passed; the existing
  bundle-size advisory remains.
- Reminder and workspace interaction suites: **19 tests passed**.
- `python scripts/check_reminder_layout.py`: built React app rendered in Chromium
  with intercepted API fixtures, without a server, database writes or real accounts.
  Thai/English at 320, 375, 699, 700, 1199, 1200 and 1440px, closed and expanded:
  **28 geometry cases passed**, **14 keyboard checks passed**.
- Checks cover reminder/navigation intersections, content bounds and scroll width,
  separate-row placement below 1200px, 44px summary touch height and page overflow.
- Two negative controls restore the old single-cell placement at 320px and confirm
  that it violates the row-separation condition. This verifies the test detects
  the reported cause, not just document overflow.
- Visually inspected captured 320px expanded Thai and 375px collapsed English views.
  Screenshots and measurements are in `ui01/`.

These are isolated layout/interaction checks with fixture counts (124 tasks), not
new live backend or full business-flow acceptance results.

## Other report items

The supplied report found no new rollback/data-integrity blocker. This change
therefore does not modify backend logic or broaden rollback of old imports.
The previous canonical rollback, local SMTP/lifecycle and restore evidence remains
documented in `../pr47-retest/FOLLOWUP.md`; it was not rerun for this CSS change.

Production SMTP/TLS/load/monitoring, independent-device offline conflicts, exhaustive
correction/timing concurrency, customer-approved scientific golden data, production
restore and customer-browser acceptance remain open. The repository still lacks
the external evidence needed to certify those gates. The historical 85/100 score
and original QA PDF are preserved; passing UI-01 does not establish 100/100 or
production sign-off.
