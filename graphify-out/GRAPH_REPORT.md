# Graph Report - VETKU  (2026-10-11)

## Corpus Check
- 223 files · ~437,551 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 43 file(s) not represented in the graph (top: .woff2 17, .csv 9, (none) 8)

## Summary
- 1403 nodes · 4038 edges · 76 communities (59 shown, 17 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 232 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a76766d2`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- dashboard.tsx
- test_analytics.py
- AuthRepository
- OpenAPI 3.1 contract
- create_app
- rules.py
- sql.py
- State
- export.tsx
- a11y
- due.tsx
- build_fish_router
- test_observations.py
- app.py
- routes/experiments.py
- offline.ts
- observations.py
- APIError
- client.ts
- SQLStore
- App.tsx
- test_foundation.py
- test_runtime.py
- load_config
- fish.tsx
- Documentation index
- Config
- get
- KUVACB AqLIMS — institutional research workspace
- utc_now
- normalize
- config.py
- test_store_memory.py
- write_headers
- pathlib
- Analytics
- compilerOptions
- test_main.py
- package.json
- devDependencies
- conftest.py
- test_contract_exports_audit.py
- Rev1 client UI feedback PDF (2026-09-16)
- headers
- gen_mockup.py
- scripts
- vite.config.ts
- Email OTP login
- Master Test Plan
- schema.d.ts
- service-worker.test.ts
- accessibility-tokens.test.ts
- values.py
- KUVACB research workspace design system
- PR #18 review round 3 (mojibake blocker in fish.tsx)
- dependencies
- Admin workspace and data edit requests
- KUVACB AqLIMS frontend index.html
- kuvth-zebrafish-lims
- requirements-dev.txt (PyYAML)
- Cost breakdown and proposed pricing
- Database schema documentation
- KUVTH Zebrafish LIMS
- CSV import planning overview
- Research results redesign Phase 0
- datetime
- AGENTS.md

## God Nodes (most connected - your core abstractions)
1. `APIError` - 116 edges
2. `State` - 93 edges
3. `headers()` - 61 edges
4. `uuid7()` - 52 edges
5. `Dashboard()` - 51 edges
6. `Analytics` - 46 edges
7. `build_fish_router()` - 42 edges
8. `iso_now()` - 40 edges
9. `audit()` - 39 edges
10. `utc_now()` - 39 edges

## Surprising Connections (you probably didn't know these)
- `Due observation workspace redesign` --conceptually_related_to--> `KUVACB research workspace design system`  [INFERRED]
  docs/design/DUE_OBSERVATION_WORKSPACE_REDESIGN_REPORT.md → design-system/kuvacb/MASTER.md
- `PR: client feedback experiments` --conceptually_related_to--> `Cost breakdown and proposed pricing`  [INFERRED]
  .qa-client-feedback/pr.md → docs/business/PROJECT_VALUATION_AND_PRICING.md
- `Compose stack (PostgreSQL)` --shares_data_with--> `Authentication endpoints (OTP, sessions, admin users, mail settings)`  [INFERRED]
  compose.yaml → api/openapi.yaml
- `test_snapshot_is_an_isolated_deep_copy()` --uses--> `MemoryStore`  [INFERRED]
  backend/tests/test_store_memory.py → backend/src/chronofish/store/memory.py
- `KUVTH Zebrafish LIMS` --references--> `Operations guide`  [EXTRACTED]
  README.md → docs/operations/OPERATIONS.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Client feedback feature set** — qa_client_feedback_pr_clean_excel_export, qa_client_feedback_pr_experiment_group, qa_client_feedback_pr_observation_drafts, qa_client_feedback_pr_unassigned_wells [EXTRACTED 1.00]
- **Test documentation set** — docs_testing_test_plan, docs_testing_test_cases_backend, docs_testing_test_cases_frontend, docs_testing_test_report, docs_testing_phase_9_uat [EXTRACTED 1.00]
- **PR18-PR20 review series** — docs_review_pr18_pr18, docs_review_pr19_pr19_1, docs_review_pr20_pr20_1 [INFERRED 0.75]
- **CSV import planning document set** — docs_planning_csv_import_readme, docs_planning_csv_import_concept_model, docs_planning_csv_import_scope_a_fish_register_readme, docs_planning_csv_import_scope_b_full_history_readme [INFERRED 0.85]
- **PR #18 review rounds** — docs_review_pr18_pr18_2, docs_review_pr18_pr18_3, docs_review_pr18_pr_18_5 [INFERRED 0.85]
- **SMTP email setup knowledge and configuration** — mission_smtp_email_mission, resources_smtp_setup, compose, mission_ku_google_smtp [INFERRED 0.85]
- **UI redesign documentation set** — design_system_kuvacb_master, docs_design_ux_ui_wcag_audit_and_redesign_plan, docs_design_due_observation_workspace_redesign_report, docs_design_research_results_redesign_report [INFERRED 0.85]

## Communities (76 total, 17 thin omitted)

### Community 0 - "dashboard.tsx"
Cohesion: 0.06
Nodes (77): analyticsFilterKeys, analyticsFilters(), DashboardFilters, filterKeys, filterQuery(), updateFilterURL(), AbnormalityOnsetChart(), ageBinLabel() (+69 more)

### Community 1 - "test_analytics.py"
Cohesion: 0.14
Nodes (10): analytics_fixture(), test_analytics_fixture_matches_manual_counts_and_shared_filters(), test_dashboard_bundle_uses_one_consistent_snapshot(), test_dashboard_endpoints_return_complete_shapes(), test_stage1_survival_does_not_increase_when_raw_alive_rises_after_a_gap(), test_survival_returns_twenty_six_stages_and_fractional_survival(), setup_eligible_embryo(), test_abnormal_promotion_inherits_first_marker_and_replays_idempotently() (+2 more)

### Community 2 - "AuthRepository"
Cohesion: 0.21
Nodes (6): AuthRepository, valid(), _iso(), _stored(), _user_payload(), _utc()

### Community 3 - "OpenAPI 3.1 contract"
Cohesion: 0.20
Nodes (11): OpenAPI 3.1 contract, Audit endpoints, Experiments, batches and injection lots endpoints, Export endpoints, Master data endpoints, Embryo and fish observation endpoints, Promotion endpoints, Timing profiles endpoints (+3 more)

### Community 4 - "create_app"
Cohesion: 0.11
Nodes (18): create_app(), handle_api_error(), handle_validation_error(), secure(), security(), limited_receive(), error_response(), MemoryStore (+10 more)

### Community 5 - "rules.py"
Cohesion: 0.09
Nodes (32): deviation_label(), enu_window(), is_backdated(), promotion_eligible_at(), stage_code(), stage_label(), stage_phase(), stage_short_label() (+24 more)

### Community 6 - "sql.py"
Cohesion: 0.21
Nodes (4): encode_result(), request_fingerprint(), validate_write_context(), StoredResponse

### Community 7 - "State"
Cohesion: 0.15
Nodes (33): _batch_rows(), export_excel(), export_r_table(), _clean_rows(), _control_rows(), _data_range(), _embryo_groups(), _embryo_matrix_rows() (+25 more)

### Community 8 - "export.tsx"
Cohesion: 0.10
Nodes (24): errorCopy, ErrorMessage(), iconPaths, Metric(), ReportPanel(), ReportTable(), FilterBar(), useDashboardMasterOptions() (+16 more)

### Community 9 - "a11y"
Cohesion: 0.05
Nodes (37): noAriaHiddenOnFocusable, noAutofocus, noInteractiveElementToNoninteractiveRole, noLabelWithoutControl, noNoninteractiveTabindex, noSvgWithoutTitle, useAriaPropsSupportedByRole, useButtonType (+29 more)

### Community 10 - "due.tsx"
Cohesion: 0.08
Nodes (47): test_rate_limit_client_bookkeeping_is_bounded(), operatorId(), parseFilters(), withFilters(), clearObservationDraft(), expired(), key(), ObservationWorkspaceDraft (+39 more)

### Community 11 - "build_fish_router"
Cohesion: 0.13
Nodes (32): build_fish_router(), change_fish_observation(), operation(), create_fish(), create_fish_observations(), operation(), operation(), create_promotions() (+24 more)

### Community 12 - "test_observations.py"
Cohesion: 0.22
Nodes (17): setup_embryo(), test_abnormal_observation_updates_embryo_projection(), test_bulk_observation_shape_and_time_boundaries_are_enforced(), test_checkpoint_and_bulk_observation_snapshot_timing(), test_checkpoint_entry_supports_independent_embryo_stages(), test_client_uuid_replayed_four_times_creates_one_audited_observation(), test_correction_only_changes_public_fields_and_deleted_observations_stay_deleted(), test_dead_embryo_rejects_later_observation_even_with_override() (+9 more)

### Community 13 - "app.py"
Cohesion: 0.16
Nodes (10): build_audit_router(), list_audit_log(), _cursor(), _encode(), _filter(), _time(), _uuid_filter(), build_export_router() (+2 more)

### Community 14 - "routes/experiments.py"
Cohesion: 0.17
Nodes (19): _active(), _active_injection_lots(), _batch_code_part(), get_batch(), get_control_counts(), list_batches(), _control_items(), _create_batch() (+11 more)

### Community 15 - "offline.ts"
Cohesion: 0.13
Nodes (36): markInvalidFields(), pageForWrite(), Workspace(), Icon(), activeWrites, countByStatus(), countQueueForActor(), countUnownedOrForeign() (+28 more)

### Community 16 - "observations.py"
Cohesion: 0.23
Nodes (22): build_observations_router(), change_observation(), operation(), checkpoint(), create_observations(), operation(), delete_observation(), due_checkpoints() (+14 more)

### Community 17 - "APIError"
Cohesion: 0.12
Nodes (30): operation(), operation(), operation(), operation(), operation(), list_embryos(), operation(), operation() (+22 more)

### Community 18 - "client.ts"
Cohesion: 0.11
Nodes (24): apiBase, ApiItem, ApiRecord, deviceId(), mutationHeaders(), requireOperator(), QueuedWrite, actionLabel() (+16 more)

### Community 19 - "SQLStore"
Cohesion: 0.10
Nodes (21): RecordingMailer, _api_value(), _camel(), _database_value(), _decode_json(), SQLStore, _client(), _config() (+13 more)

### Community 20 - "App.tsx"
Cohesion: 0.15
Nodes (21): App(), NavItem, AuthRole, AuthUser, cachedUser(), clearLogoutPending(), finishPendingLogout(), forgetUser() (+13 more)

### Community 21 - "test_foundation.py"
Cohesion: 0.09
Nodes (3): test_deviation_labels_follow_br23_in_both_languages(), test_idempotency_replay_preserves_no_content_status(), test_uuid7_shape()

### Community 22 - "test_runtime.py"
Cohesion: 0.12
Nodes (11): request_with_headers(), test_device_id_length_and_control_characters(), test_encode_result_supports_bytes_and_custom_media_type(), test_iso_now_is_utc_with_z_suffix(), test_normalize_trims_strings_recursively(), test_parse_datetime_accepts_z_suffix(), test_parse_datetime_converts_offsets_to_utc(), test_parse_datetime_rejects_garbage() (+3 more)

### Community 23 - "load_config"
Cohesion: 0.23
Nodes (16): load_config(), test_auth_secret_is_required_outside_development_and_test(), test_cors_origins_are_split_and_trimmed(), test_db_pool_size_and_overflow_bounds(), test_default_driver_is_memory_only_for_dev_and_test(), test_default_driver_is_postgres_when_app_env_is_unset(), test_empty_allowlist_and_origins_produce_empty_tuples(), test_ip_allowlist_accepts_bare_address_and_cidr() (+8 more)

### Community 24 - "fish.tsx"
Cohesion: 0.12
Nodes (30): Empty(), putQueue(), bangkokClock(), bangkokDate(), conditionLabel(), dateRange(), Fish(), FishDetail() (+22 more)

### Community 25 - "Documentation index"
Cohesion: 0.15
Nodes (14): KU registration and passwords, Site-adjusted SCNT analysis (R notebook), Client feedback workflows guide, Operations guide, KUVTH Zebrafish LIMS Development Status, Phase 9 hardening and UAT handoff, Backend migration from Go to Python (FastAPI, SQLAlchemy), Detailed Implementation Plan (Phases 0-9) (+6 more)

### Community 26 - "Config"
Cohesion: 0.11
Nodes (16): Config, SMTPMailer, create_database_engine(), sqlalchemy_url(), _execute_script(), migrate(), migration_files(), config() (+8 more)

### Community 27 - "get"
Cohesion: 0.36
Nodes (12): get(), request(), useMasterOptions(), errorText(), Members(), draftFor(), reload(), revokeSession() (+4 more)

### Community 28 - "KUVACB AqLIMS — institutional research workspace"
Cohesion: 0.17
Nodes (10): Adaptive layout, Deliberate limits, Foundations, KUVACB AqLIMS — institutional research workspace, References and decisions, KUVACB AqLIMS redesign, second iteration, Limits and follow-up, Review artifacts (+2 more)

### Community 29 - "utc_now"
Cohesion: 0.06
Nodes (39): _actor(), build_auth_router(), admin_list_sessions(), admin_revoke_session(), get_mail_settings(), invite_user(), list_users(), login() (+31 more)

### Community 30 - "normalize"
Cohesion: 0.32
Nodes (12): build_experiments_router(), activate_lot_template(), add_embryos(), create_batch(), operation(), create_lot(), delete_embryo(), duplicate_batch() (+4 more)

### Community 31 - "config.py"
Cohesion: 0.32
Nodes (3): _integer(), _networks(), test_network_allowlist_denies_unknown_client()

### Community 32 - "test_store_memory.py"
Cohesion: 0.18
Nodes (9): mutation_request(), test_concurrent_mutations_are_serialized_by_the_lock(), mutate(), test_failed_mutation_leaves_state_untouched(), fail(), test_idempotency_cache_stores_status_media_type_and_body(), test_snapshot_is_an_isolated_deep_copy(), test_successful_mutation_commits_working_copy_atomically() (+1 more)

### Community 33 - "write_headers"
Cohesion: 0.33
Nodes (6): write_headers(), record_dead(), test_concurrent_promotions_allocate_unique_running_numbers(), promote(), observe(), save()

### Community 34 - "pathlib"
Cohesion: 0.17
Nodes (6): convert(), main(), main(), resolve_pointer(), UniqueKeyLoader, walk()

### Community 35 - "Analytics"
Cohesion: 0.10
Nodes (17): build_analytics_router(), abnormality_onset(), dashboard(), fish_survival(), funnel(), guest_dashboard(), kpi(), observation_gaps() (+9 more)

### Community 36 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, isolatedModules, jsx, lib, module, moduleResolution, noEmit, resolveJsonModule (+5 more)

### Community 38 - "test_main.py"
Cohesion: 0.23
Nodes (5): main(), config(), test_main_binds_configured_port(), test_main_runs_migrations_before_serving_for_sql_drivers(), test_main_skips_migrations_for_memory_driver()

### Community 39 - "package.json"
Cohesion: 0.17
Nodes (11): name, private, type, version, @biomejs/biome, happy-dom, openapi-typescript, @types/react (+3 more)

### Community 40 - "devDependencies"
Cohesion: 0.17
Nodes (12): devDependencies, @biomejs/biome, fake-indexeddb, happy-dom, openapi-typescript, @types/react, @types/react-dom, typescript (+4 more)

### Community 41 - "conftest.py"
Cohesion: 0.18
Nodes (9): client(), fixed_clock(), master_data(), create(), store(), store_operator(), unique_key(), test_parent_groups_scope_batches_and_reports() (+1 more)

### Community 42 - "test_contract_exports_audit.py"
Cohesion: 0.10
Nodes (10): _parse_timing_csv(), build_xlsx(), _cell_xml(), _column(), _row_xml(), _sheet_xml(), test_excel_export_can_select_flat_sheets(), test_excel_export_is_read_only_valid_14_sheet_xlsx() (+2 more)

### Community 44 - "Rev1 client UI feedback PDF (2026-09-16)"
Cohesion: 0.25
Nodes (9): Rev1 client UI feedback PDF (2026-09-16), KUVTH Zebrafish LIMS UI Review guide, PR18 Review Round 1 (not merge-ready), PR18 Review Round 4 (PDF feedback status), Timing deviation chart always empty (SCNT/IVF filter), PR18 Open PDF Decisions, Injection Lot number gaps decision, Number of manipulated embryos field meaning (+1 more)

### Community 45 - "headers"
Cohesion: 0.16
Nodes (30): test_control_comparison_excludes_scnt_and_includes_day_four(), test_egg_count_is_not_reported_as_missing_after_removing_it_from_the_entry_form(), test_manual_fish_is_not_counted_as_promoted_and_uses_unknown_metadata(), test_stage2_total_reconciles_alive_and_dead_and_keeps_other_statuses_in_composition(), test_zero_denominator_and_missing_checkpoint_are_explicit(), create_batch(), headers(), setup_master() (+22 more)

### Community 46 - "gen_mockup.py"
Cohesion: 0.32
Nodes (3): build(), mapping_sheet(), stage_sheet()

### Community 47 - "scripts"
Cohesion: 0.25
Nodes (8): scripts, build, check, dev, format, generate:api, lint, test

### Community 48 - "vite.config.ts"
Cohesion: 0.38
Nodes (4): serviceWorkerSource(), hashedShell(), vite, @vitejs/plugin-react

### Community 49 - "Email OTP login"
Cohesion: 0.40
Nodes (6): Email OTP login, PR19 Review 1 (Email OTP login), PR19 Review 2 (member impersonation loophole), Clone experiment bypass of operator identity, Lesson 1: Set up KU-Google SMTP, KU-Google SMTP settings cheat sheet

### Community 50 - "Master Test Plan"
Cohesion: 0.40
Nodes (6): Phase 9 UAT and release sign-off, Backend Unit Test Case Design, Frontend Unit Test Case Design, Master Test Plan, Test Report (2026-09-05), Backend 90% coverage gate

### Community 51 - "schema.d.ts"
Cohesion: 0.33
Nodes (5): components, $defs, operations, paths, webhooks

### Community 55 - "values.py"
Cohesion: 0.18
Nodes (6): _email(), MailSettings, UserUpdate, check_password(), hash_password(), _snake()

### Community 56 - "KUVACB research workspace design system"
Cohesion: 0.18
Nodes (13): KUVACB research workspace design system, Color tokens (primary, lime, sidebar), Responsive and touch workflow rules, Due observation workspace redesign, Exception-first plate map with single editor, KUVACB redesign review, KUVACB design system (MASTER.md), Redesign validation (Chromium, 147 tests, responsive widths) (+5 more)

### Community 57 - "PR #18 review round 3 (mojibake blocker in fish.tsx)"
Cohesion: 0.67
Nodes (3): PR #18 review round 2 (not ready: MySQL rollback), PR #18 review round 3 (mojibake blocker in fish.tsx), PR #18 review round 5 (ready to merge)

### Community 58 - "dependencies"
Cohesion: 0.67
Nodes (3): dependencies, react, react-dom

### Community 72 - "Cost breakdown and proposed pricing"
Cohesion: 0.29
Nodes (8): Authentication endpoints (OTP, sessions, admin users, mail settings), Cost breakdown and proposed pricing, Import of active experiment data, Phase 2: university login and user management, KU-Google SMTP with App Password, Mission: VETKU email sending (OTP and invites), SMTP relay / App Password availability gap, SMTP Setup Resources

### Community 73 - "Database schema documentation"
Cohesion: 0.29
Nodes (8): Fish and specimens endpoints, Database schema documentation, Clone fish tables (clone_fish, fish_observation, specimen), Engine-neutral schema design (UUIDv7, soft delete, row_version), Infra tables (audit_log, request_idempotency, fish_running_sequence), Protocol tables (protocol, stage_definition, stage_timing), PostgreSQL canonical / MySQL generated migrations, Write headers and idempotency keys

### Community 74 - "KUVTH Zebrafish LIMS"
Cohesion: 0.32
Nodes (7): Backend pinned dependency constraints, Compose stack (PostgreSQL), Compose stack (MySQL profile), ADR-001: Move backend from Go to Python, CI workflow, Backend src layout (chronofish), KUVTH Zebrafish LIMS

### Community 77 - "CSV import planning overview"
Cohesion: 0.47
Nodes (6): CSV import concept model, CSV import planning overview, Scope A field guide (fish_register.csv columns), Scope A fish register import, Scope B field guide (batches, lots, observations CSVs), Scope B full history import

### Community 78 - "Research results redesign Phase 0"
Cohesion: 0.67
Nodes (4): Analytics endpoints, Research results redesign Phase 0, Stage 2 Kaplan-Meier survival, Monotonic stage 1 survival

## Knowledge Gaps
- **179 isolated node(s):** `kuvth-zebrafish-lims`, `$schema`, `includes`, `indentStyle`, `indentWidth` (+174 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 375 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `uuid7()` connect `APIError` to `AuthRepository`, `sql.py`, `due.tsx`, `build_fish_router`, `app.py`, `routes/experiments.py`, `observations.py`, `SQLStore`, `test_foundation.py`, `test_runtime.py`, `values.py`, `utc_now`, `normalize`?**
  _High betweenness centrality (0.263) - this node is a cross-community bridge._
- **Are the 11 inferred relationships involving `APIError` (e.g. with `_validate_observation()` and `AuthService`) actually correct?**
  _`APIError` has 11 INFERRED edges - model-reasoned connections that need verification._
- **What connects `kuvth-zebrafish-lims`, `$schema`, `includes` to the rest of the system?**
  _179 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dashboard.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.05759623861298854 - nodes in this community are weakly interconnected._
- **Why does `APIError` connect `APIError` to `test_store_memory.py`, `AuthRepository`, `create_app`, `sql.py`, `State`, `test_contract_exports_audit.py`, `build_fish_router`, `app.py`, `routes/experiments.py`, `observations.py`, `SQLStore`, `test_runtime.py`, `values.py`, `utc_now`, `normalize`?**
  _High betweenness centrality (0.129) - this node is a cross-community bridge._
- **Are the 70 inferred relationships involving `State` (e.g. with `_active()` and `_active_injection_lots()`) actually correct?**
  _`State` has 70 INFERRED edges - model-reasoned connections that need verification._
- **Should `test_analytics.py` be split into smaller, more focused modules?**
  _Cohesion score 0.14210526315789473 - nodes in this community are weakly interconnected._