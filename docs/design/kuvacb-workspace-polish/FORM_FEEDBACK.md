# Form spacing and action feedback

Implemented on `feat/kuvacb-redesign-v2` in the primary repository.

## Changes

- Experiment footer buttons use their content width, a 44px minimum height and explicit 32px vertical / 40px horizontal gaps. The recording attribution can wrap onto its own row instead of being squeezed against a 200px button.
- Shared form disclosure bodies have 36px top padding. Inline grids inside disclosures retain their padding without overflowing their parent. This covers fish housing/sex/notes and optional experiment fields.
- Direct form buttons no longer stretch across an entire grid row. Recording attribution in a form button row has its own line. Existing required fields, keyboard focus and validation remain.
- Found and fixed a separate mobile HPA form overflow during the broader review: grid children now have `min-width: 0`; the stage table scrolls inside its disclosure. The scroll region is labelled and keyboard focusable.
- Reused the member Toast UI, including dismissal, five-second timeout, hover/focus pause and accessible live announcements. Existing member account actions retain their colors and behavior.
- Data mutations share the existing queue lifecycle: yellow when durably stored on device and awaiting sync, green after the server confirms, red on rejection. Initial network/server failures show a yellow retry message while durable work remains queued. Authentication expiry explains that sign-in is needed. An HTTP 200 with rejected result rows produces a red notification, never a blanket green success.
- A failed item remains visible when another item in a bulk operation succeeds. A new user write can show waiting feedback again; background sync cannot hide an existing failure.
- Added feedback for explicit draft saving, validation, login/verification/logout, file download/print dialog, retry/discard, and a fish save with no new observations. Tabs, navigation and individual field changes remain quiet. Inline errors and queue indicators remain available after the Toast expires.
- Legacy inline banners can contain success text, so only explicitly marked error messages emit a failure Toast. They do not turn successful saves into red notifications.

No runtime dependency was added. API, authentication, draft and queue behavior are preserved; only an additional queue-deferred notification event was added.

## Reproduction and verification

Before the fix, the experiment footer had no gap and a 200px minimum-width button; at 375px its recording note was squeezed to 82px. The fish disclosure had zero top padding, placing its first label 1px below the summary. The opened HPA table also widened the whole phone form; setting grid children to `min-width: 0` eliminated that overflow while retaining internal table scrolling.

- Biome, TypeScript and Docker production build passed.
- 191 tests passed in 27 files, including an integrated checkpoint confirmation test and real durable-queue tests with delayed success, offline storage, rejection, retry and partial HTTP 200 results. Coverage: lines 86.13%, branches 78.42%, above configured thresholds.
- After the final CSS/scroll-region adjustment, all 33 workflow-form tests passed again.
- [85 compiled browser checks](form-feedback-checks.json) passed at 1440, 820, 375 and 320px. Reviewed experiment create/edit, injection lots, fish registration/details/corrections/specimens, all seven master categories and locations, timing, controls, member/mail settings and export. Thai experiment/fish forms were also checked at desktop and phone sizes. Screenshots were visually inspected.
- Actual checkpoint button submissions in the isolated browser produced green success and red rejection Toasts from intercepted API responses. Native form validation produced both a Toast and the existing inline summary. No domain data was written to the real API or accounts.
- Rebuilt/recreated only frontend with `--no-deps`. Frontend, API and PostgreSQL are healthy. Existing database volumes and seed data were preserved; seed was not rerun.

Browser checks use the isolated headless Chrome workflow, with service worker bypass and fixture responses. They are not live-account or physical-device end-to-end tests. The production JS bundle is approximately 501kB / 142kB gzip and triggers Vite's 500kB advisory; no bundle splitting or warning suppression was introduced for this UI task.

## Spacing follow-up

Increased the footer gaps from 16px/24px to 32px/40px and disclosure top padding from 20px to 36px after user review. The fish summary-to-first-label distance is 37px including its border. [Eight compiled browser checks](spacing-followup-checks.json) passed at 1440, 820, 375 and 320px with no page overflow. Thai phone screenshots were visually reviewed. The frontend production build passed Biome and TypeScript; only frontend was rebuilt/recreated, and frontend, API and PostgreSQL are healthy. Unit tests were not repeated for these two CSS value changes.

[Latest experiment phone](spacing-followup-experiment-375.png) · [latest fish phone](spacing-followup-fish-375.png) · [latest experiment desktop](spacing-followup-experiment-1440.png) · [latest fish desktop](spacing-followup-fish-1440.png).

[Experiment footer, Thai phone](form-feedback-experiment-th-375.png) · [fish registration, Thai phone](form-feedback-fish-th-375.png) · [experiment desktop](form-feedback-experiment-1440.png) · [fish desktop](form-feedback-fish-1440.png) · [checkpoint success](form-feedback-checkpoint-success.png) · [checkpoint rejection](form-feedback-checkpoint-failure.png).
