# KUVACB laboratory workspace refinement

Approved scope: checkpoint editor, due queue, experiment lists/forms, fish checks/registry, members and management screens. Work stays on `feat/kuvacb-redesign-v2` in the primary repository.

The implementation keeps the existing API, authentication, validation, queue handling and scientific status meanings. Dashboard artwork remains static.

Latest follow-up: [form spacing and action feedback](FORM_FEEDBACK.md), with 191 tests and 85 compiled browser checks.

Latest visual review: [login/sidebar cleanup and proposed refinements](REVIEW_ROUND.md), with 104 compiled browser checks and a confirmed mobile reference-category text overlap to address next.

All six approved refinements are now implemented: [delivery and verification](REFINEMENT.md).

## Delivered

- Checkpoint editor: compact context/status and time rows, one aligned metrics strip, optional bulk tools in a native disclosure. Desktop retains the plate/editor pairing; phone presents the plate first. Well selection, editor scrolling, return-to-plate focus, historical correction and draft handling remain. The confirmation bar stays in normal flow while disabled and becomes sticky when actionable. Alive/abnormal remains yellow; dead remains red; queued work remains distinct.
- Due queue: overdue and due/upcoming lots have separate labelled groups, real counts and explicit opening actions. Ordering/deduplication continues to use `nextCheckpoints`; site/operator filters remain.
- Experiments: unified search/filter toolbar, separately readable project/date/profile metadata, and two-column forms with wider controls on desktop/tablet. Phone forms stack. Existing required-field/error behavior and optional sections remain.
- Fish: daily work has current-list/recorded/awaiting counts using existing records, clear box headers and aligned health/outcome controls. Registry search is immediately available outside the advanced filter disclosure; its heading/description reflects registry work. The existing save-all behavior is unchanged and still explained in the daily view.
- Members: compact saved identity and role/operator overview; access editing opens on demand. Unsaved access changes remain visibly marked when the form is folded. Account status, known offline work, risk checks, session controls and disable confirmation remain accessible.
- Management: create forms open on demand; edit forms and retire confirmations retain their behavior. Shared cards, table spacing, reference-category controls and audit before/after panels follow the existing KUVACB tokens.

Styling uses the existing React/native elements and a scoped `frontend/src/workspaces.css`, with no additional runtime dependency or image. Motion is confined to short surface/arrow feedback and respects reduced motion; data and status surfaces remain stable.

## Verification

- Biome, TypeScript and production build passed in Docker.
- `npm.cmd test -- --coverage --maxWorkers=2`: 181 tests passed in 26 files. Lines 86.11%, branches 78.59%, above the configured thresholds. An initial unrestricted-worker run timed out in a Dashboard test under concurrent build/dev startup; the constrained reruns passed, without changing timeout settings or Dashboard code.
- All 103 browser checks passed using isolated headless Chrome with populated, intercepted fixture responses. They cover 1440, 1180, 820, 812, 375 and 320px; creation/edit disclosures, ready confirmation, yellow abnormal wells, fish counts, registry search, English keyboard tabs, long identifiers and Dashboard/Login regression views. Screenshots and `browser-checks.json` are from the latest compiled frontend served through Vite preview on port 5175, independently of Docker.
- No domain writes were sent to the live API. Existing tests cover writes, validation, drafts, queue rejection/replay, access changes and account risk checks. This is not a live-account end-to-end test or a physical-device performance measurement.
- The first frontend rebuild/recreation with `--no-deps` succeeded. The final image export after a 44px member-button adjustment failed with containerd `input/output error`, followed by Docker Desktop startup failures. The approved Desktop restart timed out. A subsequent stop/start logged `WSL_E_USER_VHD_ALREADY_ATTACHED`, then bootstrap reported no filesystem and a failed automatic formatting attempt (`mkfs.ext4: No such device or address`). Desktop was stopped to protect data. Docker delivery remains blocked; container/volume integrity cannot currently be verified. No manual disk repair, factory reset, pruning, seed execution or API/PostgreSQL recreation was performed. The latest local production build passed.

### Docker retry resolved

On the user's subsequent rebuild request, Docker Desktop and the daemon were running again. Started the original PostgreSQL container and waited for health before starting the original API. Rebuilt the latest frontend successfully and recreated only that service with `--no-deps`. All three services are healthy. `http://localhost:5173/` returns HTTP 200 and serves the verified production assets `index-DWbpUf1g.js` / `index-DUudcDXC.css`; the proxied `/api/v1/health` returns `status: ok`. Docker delivery is now complete. No seed was rerun and no volumes were deleted. Full database integrity and live-account workflows were not independently audited.

## Screenshots

The later report redesign adds a two-page meeting brief as the default PDF and a separate complete analytical report. See [implementation and verification](MEETING_REPORT.md) and the [Thai sample PDF](meeting-report-th.pdf).

[Checkpoint desktop](checkpoint-workspace-1440.png) · [phone](checkpoint-workspace-375.png) · [due queue](due-1440.png) · [experiments](experiments-1440.png) · [experiment form](experiment-form-1440.png) · [daily fish](fish-check-1440.png) · [registry phone](fish-registry-375.png) · [members](members-1440.png) · [master data](master-1440.png) · [audit detail](audit-1440.png).
