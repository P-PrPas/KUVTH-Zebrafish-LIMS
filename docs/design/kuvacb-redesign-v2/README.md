# KUVACB AqLIMS redesign, second iteration

Branch: `feat/kuvacb-redesign-v2`.

The redesign aligns the application with KUVACB's published teal/lime identity
and Thai font families. It replaces Plex Thai working text with locally hosted
Noto Sans Thai, introduces Prompt headings, improves hierarchy and spacing,
and gives the overview a clear primary workflow action.

## Scope

| Surface | Change |
| --- | --- |
| Application shell | Grouped navigation, compact phone labels with complete accessible names, contained account menu, clearer operator and synchronization controls |
| Research overview | Light institutional hero, primary embryo-check action, two secondary shortcuts, restrained metrics and tabs |
| Working pages | Shared typography, form spacing, panel treatment, table styles, responsive headings and controls |
| Authentication | Artwork/form desktop composition, compact phone introduction, existing sign-in/registration/reset/verification states |
| Guest overview | Wider summary surface and consistent metric presentation |

Shared CSS reaches experiments, embryo observations, fish care, promotions,
control results, timing profiles, export/print, master data, audit, and members.
Domain logic, API payloads, queues, and role restrictions remain the existing ones.
No dependency was added. Existing uncommitted authentication and backend work
was preserved when creating the branch; this work has not been committed or pushed.

The [verified design system](../../../design-system/kuvacb-v2/MASTER.md) records
reference analysis, typography, colors, and layout decisions. The first redesign's
design system and review artifacts remain intact.

## Review artifacts

Open [the self-contained visual review](review.html) for desktop, tablet, and phone
screenshots. Images show isolated fixture data and a Demo researcher, not real
records. [Viewport results](viewport-results.json) and
[interaction checks](interaction-results.json) contain the verification evidence.

## Verification

- `npm run check`: Biome, TypeScript, and Vite production build.
- `npm test -- --coverage`: frontend tests and the repository's existing coverage
  thresholds passed: 176 tests across 25 files. Coverage: statements 83.60%,
  branches 78.03%, functions 80.03%, lines 85.95%.
- Headless Chrome: all eleven workspace destinations, the experiment form,
  checkpoint editor, sign-in, and guest overview at 1440×1000, 375×812,
  820×1180, 1180×820, 812×375, and 320×812: 90 checks, no page overflow,
  missing images, empty screens, or displayed request errors.
- Native Enter activation for Account and More; account panel fits the phone.
  More retains every destination and closes when navigating.
- Required form submission focuses the linked error summary. Experiment input
  survives phone-to-tablet resizing. Per-well stage/note drafts survive rotation
  and selecting another well.
- Short landscape puts the confirmation bar in document flow. English switching,
  reduced motion, and 200% text scaling retain a contained overview. Print omits
  the navigation and decorative banner.
- Regression tests cover the primary overview shortcut, compact-label accessible
  names, role-specific navigation, sign-out, font loading, token contrast, and
  localized authentication/guest states including loading, errors, and resend.

Browser verification used the existing repository's headless Chrome/CDP approach
with a new isolated browser profile and intercepted fixture API responses. It did
not connect to production accounts or alter running application containers.

## Limits and follow-up

Chrome viewport emulation does not replace physical iPad/Safari, Firefox,
VoiceOver/NVDA, or researcher acceptance testing. This is not a claim of complete
WCAG conformance. Browser interaction checks use mocked responses; existing unit
tests verify request behavior, but backend integration was not rerun for this UI work.

`npm ci` reported four high-severity dependency audit findings in the existing
dependency tree. Versions were kept unchanged in this redesign.

Graphify's code graph was refreshed. SQL/data-only files and some entry modules
are not symbol-extracted; generated community labels are structural fallbacks.
This is a code refresh, not a new semantic extraction of every document or image.
The updated graph contains 1,403 nodes, 4,038 edges, and 76 communities.

## Follow-up: alive but abnormal wells

The researcher confirmed that alive/abnormal wells must remain yellow. Previously,
plate color followed the workflow state: unreviewed was neutral and saved was
green, so abnormality disappeared visually after confirmation. The regression
test reproduced the missing biological styling before the fix.

Biological styling now remains separate from saved/queued/reviewed state.
Alive/abnormal assigned wells use `#fff1a8` with `#725100` text and an explicit
abnormal label; saved confirmation marks and filters remain intact. Dead wells
remain red, and unassigned locations retain their existing neutral styling.

The regression covers prior abnormality, an alive draft, queue confirmation, and
changing the outcome to dead. Contrast, lint, TypeScript, production build, and
176 frontend tests passed. Headless Chrome verified the actual Docker CSS before
and after confirmation, selected-well styling, and phone containment using
isolated fixture responses. See [the phone screenshot](abnormal-yellow-mobile.png).
The frontend Docker container was rebuilt; API, database, accounts, and seeded
records were preserved.

## Follow-up: compact operator control

The header now shows an icon, current operator name, and chevron in a compact
disclosure. Its panel retains the native select and existing session/reload
behavior. It stays separate from the signed-in account. An unselected operator
shows the explicit selection prompt; the write gate opens the panel and focuses
the select. Escape closes it and returns focus, while outside clicks and app
navigation dismiss it.

Phone layouts place operator, language, and account controls on one row and sync
status below. The operator panel spans the controls' available width. Confirmation
areas in embryo observation, experiment/lot, fish, promotion, controls, timing,
and master-data forms show the same selected operator via a shared display-only
context, with no additional requests or changes to write payloads.

178 frontend tests passed with the original coverage thresholds (branches
78.17%), along with lint, TypeScript, and the production build. Headless Chrome
checked Enter/Escape, panel containment, and page overflow at six viewport sizes,
plus Thai/English recorder labels in observation and experiment confirmation.
The same browser checks passed against the rebuilt Docker frontend; changing
the selected operator survived reload and updated both header and recorder label.

Images: [desktop header](operator-header-1440.png),
[desktop panel](operator-panel-1440.png), [phone header](operator-header-375.png),
[phone panel](operator-panel-375.png). The frontend Docker image was rebuilt;
existing API, accounts, database volume, and seed data were preserved.
