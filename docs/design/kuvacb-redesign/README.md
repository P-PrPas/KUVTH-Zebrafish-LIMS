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

## iPad workspace verification

The tablet refinement uses available CSS viewport space, without device sniffing
or new runtime dependencies. Portrait windows show five labelled navigation items,
a two-column experiment form, and a plate beside its selected-well editor. At
1000-1199px the logo and navigation share a single row. Wider tablets retain the
sidebar; narrow split windows use the stacked phone layout.

| Screen | Portrait (820 x 1180) | Landscape (1180 x 820) |
| --- | --- | --- |
| Research overview | [Overview](dashboard-ipad-portrait.png) | Navigation and overflow checked |
| New experiment | [Form](experiment-form-ipad-portrait.png) | Entered values retained on resize |
| Embryo observation | [Plate and editor](checkpoint-ipad-portrait.png) | [Plate and editor](checkpoint-ipad-landscape.png) |

- Chromium with touch enabled: all ten routes checked at 375x812, 507x1024,
  694x768, 700x1024, 768x1024, 820x1180, 834x1194, 1024x1366, 1024x768,
  1180x820, 1194x834, 1366x1024, and 1440x1050. No page-level horizontal overflow.
- Checked the new-experiment form and observation workspace at the same 13 sizes;
  verified the tablet editor remained beside the plate.
- Entered an experiment code and resized repeatedly; the draft remained intact.
- Selected A2, entered its stage and note, rotated the viewport, selected A3 and
  entered its stage, then returned to A2. Each well retained its own draft.
  Confirming delivered both observations to the isolated in-memory API.
- Measured well buttons, the stage field, and confirmation controls at 768, 820,
  1180, and 1366px: each met the 48x48 CSS-pixel touch target chosen for this UI.
- Used touch navigation through More and switched Thai/English. Checked reduced
  motion and 200% text scaling on the lab-settings page.
- At 820x480, verified the editor and confirmation bar used normal document flow
  and the notes field could be focused and scrolled into view.
- Re-ran `npm run check` and all 147 frontend tests with coverage successfully.

These are Chromium viewport/touch emulations, not tests on physical iPads or
Safari. The short viewport check does not emulate the real iPad software keyboard;
Safari keyboard, pinch zoom, and VoiceOver remain device acceptance checks.

To review manually, select an operator, open an experiment form, enter a code,
and rotate or resize without navigating away. Then open an observation lot, record
different stages/notes in two wells, rotate, revisit each well, and confirm. Check
the More menu, field labels, selected-well outline, and save controls in both
orientations and in a narrow split window.
