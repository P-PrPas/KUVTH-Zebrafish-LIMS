# KUVACB redesign review

These screenshots show the redesigned frontend against an isolated in-memory API.
Experiment codes, counts, and the Demo operator are test data.

| Screen | Desktop | Mobile |
| --- | --- | --- |
| Research overview | [Overview](dashboard-desktop.png) | [Overview](dashboard-mobile.png) |
| New experiment | [Form](experiment-form-desktop.png) | [Form](experiment-form-mobile.png) |
| Embryo observation | [Selected-well editor](checkpoint-desktop.png) | Tested at the widths below |

## Validation

- `npm run check`: Biome, TypeScript, and Vite production build passed.
- `npm test -- --coverage`: 147 tests passed across 23 files; 87.76% line coverage,
  78.21% branch coverage, meeting the existing thresholds.
- Added regressions for case-insensitive experiment code/date search, clearing the
  search, empty matches, and contrast of the brand/status text token pairs.
- Chromium: checked all ten navigation destinations at 375×812, 768×1024,
  1024×768, 812×375, and 1440×1050, with no page-level horizontal overflow.
- Exercised experiment creation against the isolated API, required-field errors,
  focus on the error summary, retention of entered values, and correction/resubmit.
- Exercised per-well stage selection and observation submission; a subsequent visit
  showed the recorded stage as the previous observation.
- Checked English switching, mobile More navigation, route focus, reduced motion,
  and 200% text scaling on the lab-settings page.

Validation used Chromium and development data. It does not establish full WCAG
conformance or replace Safari/Firefox, screen-reader, and researcher acceptance
testing. Existing offline-queue, scientific-reporting, and export tests remain in
the frontend suite; this change does not alter their underlying domain behavior.

Design foundations are recorded in
[the KUVACB design system](../../../design-system/kuvacb/MASTER.md).
