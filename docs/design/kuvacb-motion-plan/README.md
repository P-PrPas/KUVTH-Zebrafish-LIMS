# Implemented motion and Dashboard presentation

Approved and implemented on 2026-10-11 in `feat/kuvacb-redesign-v2`.

## Delivered

- Dashboard and sign-in share an original optical biological illustration, with deep teal surfaces, lime accents, a fine inset frame and dimensional light. The asset is generated decorative artwork, not microscopy evidence or experimental results. Original KUVACB marks and local institutional fonts remain.
- The original 1536×1024 generated PNG is encoded as a 1200×800 WebP, 110,174 bytes. Its source is the imagegen output `01a12a92-3722-7310-8a36-06a086bb8eb4/exec-579e38b8-f836-4f3b-baf9-bd20aab09a77.png`; the application asset lives in `frontend/public/brand/optical-embryo.webp`.
- Sign-in transform/opacity motion is confined to decorative image/light layers. A visible pause button, OS reduced-motion preference, hidden-tab detection and offscreen detection control it. Dashboard artwork is static. Sign-in forms have no entrance delay; phone sign-in keeps a compact introduction.
- Welcome copy has a short staggered entrance. Buttons, navigation colors, clickable shortcuts and operator/account panels have brief transitions. Data/status surfaces do not have continuous color animation.
- Survival graphs use more plot space, 25% grid intervals and fewer ticks at narrow widths. A ResizeObserver chooses geometry from the chart container. Separate legend values replace crowded endpoint labels, with explicit last-known-survival explanation; both color and dash patterns identify groups.
- Embryo points now have larger touch targets and a visible selection readout, with click, focus, Enter/Space and arrow-key navigation. Existing fish selection, Kaplan–Meier step geometry, CI, event/censor marks, filters and scientific calculations remain.
- Risk summaries are available in native disclosures. Toggles also update the visible risk summary and visible-series count; full supporting data remains available. Loss-rate rows use responsive HTML, separate counts/percentages and a fixed 0–100% bar scale; unknown denominators are not displayed as zero percent.

## Verification

- `npm.cmd run check`: Biome, TypeScript and production build passed.
- `npm.cmd test -- --coverage`: 180 tests in 26 files passed. Lines 86.10%, branches 78.44%, above configured thresholds.
- Rebuilt Docker frontend: 48 browser checks across 1440, 1180, 820, 812, 375 and 320px, covering Dashboard stages, sign-in, experiments, fish and the embryo checkpoint editor. No document overflow, missing images or visible request errors in the fixtures. Checked point selection, pause/resume, offscreen stopping, reduced motion and yellow abnormal wells. Background device-sync reports were intercepted; no domain write was submitted.
- Additional fixture checks cover two sites, four groups per site and a long unbroken group name at desktop/tablet/phone widths.
- The long-name check exposed wrapping in the insight paragraph; it now wraps within its panel at 320/375px.
- Docker image `vetku-pr43-frontend` rebuilt and frontend service recreated with `--no-deps`. Frontend, API and PostgreSQL are healthy. Database volumes, accounts and seed data were not modified.

Browser checks use isolated Chrome and fixture responses against the real compiled frontend. They are not an authenticated live-data end-to-end test or a physical-device GPU benchmark.

## Follow-up: static Dashboard artwork

At user request, the Dashboard artwork now renders as a static image, with no
animation controller, observers or pause button. The biological-art caption was
removed from the shared artwork on both Dashboard and sign-in. Sign-in retains
its existing optional motion controls. The cell image and optical frame remain.

At this checkpoint, the previous redesign had reached both embryo and fish survival charts. The process
overview received shared panel styling only; its pipeline bars and arrangement
were not redesigned specifically. Supporting fish composition/age/census views
also retained their previous structure. The completion below supersedes this checkpoint.

Follow-up validation: 181 tests passed, Docker lint/TypeScript/build passed, and
the rebuilt Dashboard has zero artwork animations and no motion controls or
caption at 1440, 375 and 320px. The frontend container is healthy.
[Static desktop](static-dashboard-1440.png) · [static phone](static-dashboard-375.png).

## Screenshots of the compiled Docker frontend

- [Dashboard desktop](implemented-dashboard-1440.png) · [phone](implemented-dashboard-375.png)
- [Embryo chart desktop](implemented-chart-1440.png) · [phone](implemented-chart-375.png)
- [Fish survival](implemented-fish-chart-1440.png)
- [Sign-in desktop](implemented-login-1440.png) · [phone](implemented-login-375.png)

[Approved direction and references](PLAN.md) · [original composition study](concept.html) · [browser checks](browser-checks.json)

## Dashboard completion and five-part plan

Completed on 2026-10-11, following authorization to finish the Dashboard and remaining plan.

| Part | Delivered state |
| --- | --- |
| Dashboard | All three tabs share the chart/surface system. This pass adds ordered process cards with counts, API percentages and a qualified lowest-transition annotation. Desktop presents steps side by side; tablet/phone uses a readable vertical sequence. Fish status, age and sex are immediately visible in a modular profile; all fish-box cards, including empty/unassigned boxes, remain available. |
| Sign-in | Existing optical composition, calm form surface and phone layout retained and rechecked. Pause/resume and reduced-motion behavior verified again in the compiled build. No new sign-in animation added in this pass. |
| Shared interactions | Existing navigation, action and operator/account transitions retained. This pass completes save feedback: a short success check only for the existing saved queue state; pending and syncing remain distinct. |
| Stable workspaces | No animated counts, moving wells, recolored status semantics or data-refresh entrance effects. Embryo abnormal/alive remains yellow. Timing/control summaries gain aligned values and smaller bar tracks; source tables retain local scrolling and native disclosure controls. |
| Original artwork | The compressed 110KB optical cell asset and institutional typography remain. Dashboard has zero artwork motion and no biological-art caption. No additional artwork or runtime dependencies introduced. |

Additional inspiration: reviewed the official [Linear Insights](https://linear.app/insights) page and the dashboard examples in [Linear's design guidance](https://linear.app/now/dashboards-best-practices), including its side-by-side monthly data-request dashboard. Adapted its organized comparison panels and context near numbers to our existing KUVACB palette and scientific data. No Linear assets or UI code copied.

Scientific presentation: pipeline bars compare counts with the largest step; percentages come from the API. A lower downstream count can include specimens that have not reached that step, so the annotation no longer asserts a causal bottleneck. Non-monotonic data suppresses the annotation and retains the quality warning. Unknown percentages stay unknown. Box counts are not capacity or measured density; missing status information is not labelled as an empty box.

Validation for completion:

- Biome, TypeScript and production build passed; 181 tests passed across 26 files. Coverage: lines 86.11%, branches 78.54%.
- 46 compiled-frontend browser checks at 1440, 1180, 820, 812, 375 and 320px: three tabs, populated supporting data, long labels, expanded source tables, English keyboard tab navigation, sign-in pause/resume and desktop reduced motion. No page overflow, out-of-card summary labels, missing images or fixture errors. No domain writes submitted.
- Frontend rebuilt/recreated with `--no-deps`; API/PostgreSQL containers and their volumes/accounts retained. All three services healthy.
- Browser responses are isolated fixtures against the compiled Docker frontend, not a live-account E2E test. Physical phone/GPU performance remains unmeasured.

[Process desktop](completed-overall-1440.png) · [process phone](completed-overall-375.png) · [fish profile desktop](completed-stage2-1440.png) · [fish profile phone](completed-stage2-375.png) · [completion checks](completion-browser-checks.json).
