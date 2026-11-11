# KUVACB AqLIMS — institutional research workspace

This is the verified direction for `feat/kuvacb-redesign-v2`. The previous
`design-system/kuvacb/MASTER.md` records the first redesign and is retained.
Implementation tokens live in `frontend/src/styles.css`.

## References and decisions

- [KUVACB](https://kuvacb.com/): use the official logo and existing laboratory
  illustration without altering their proportions. Its published stylesheet
  defines primary `#006664` and secondary `#b2bb1e`. Browser inspection confirmed
  Prompt and Noto Sans Thai in the website. Use those same families, assigning
  Prompt to headings and Noto Sans Thai to working text for readable Thai forms.
- [HeroInspo](https://heroinspo.com/): borrow the clear separation of headline,
  supporting copy, image, and action. Keep the hero on the overview and sign-in
  screens; record-entry screens start directly with their task.
- [Navbar Gallery](https://www.navbar.gallery/): use distinct navigation groups,
  a restrained active indicator, and separate account controls. The visible
  Chesapeake Plywood example informed grouping and brand hierarchy rather than
  a full-screen mega-menu unsuitable for laboratory work.
- [CTA Gallery](https://www.cta.gallery/): the Tines and Overtake examples informed
  action hierarchy and generous, legible spacing. The overview has one primary
  action, Check embryos, with two subordinate workflow shortcuts.

The UI/UX skill's minimal, grid-based dashboard recommendation fits this product.
Its suggested blue/orange palette and Fira typography do not fit the institutional
reference and were not adopted.

## Foundations

| Role | Token | Value |
| --- | --- | --- |
| Primary action | `--primary` | `#006664` |
| Brand accent | `--brand-lime` | `#b2bb1e` |
| Navigation | `--sidebar` | `#004d4b` |
| Active navigation | `--nav-active` | `#edf2d7` |
| Hero | `--hero-surface` | `#e8efea` |
| Canvas | `--canvas` | `#f5f7f6` |
| Text | `--ink` | `#183b39` |
| Supporting text | `--muted` | `#526a67` |
| Heading family | `--font-heading` | Prompt |
| Working text | `--font-body` | Noto Sans Thai |

- Host Thai and Latin WOFF2 subsets locally with `font-display: swap`. Preload
  only the two body subsets. Keep the existing Plex Mono for identifiers.
  Font licenses are beside the files in `frontend/public/fonts/`.
- Use 16px working text, 14px supporting text, and 48px primary controls. Give
  Thai headings sufficient line height for marks. Use tabular numerals for data.
- Use white panels, quiet borders, 8px control corners, 16px panel corners, and
  20px feature-panel corners. Avoid arbitrary colors on successive KPI cards.
- Keep amber, red, green, and blue for their existing semantic status meanings.
  Pair states with labels or symbols; lime is an accent with dark text.
- Preserve native form controls, visible labels, keyboard focus, required-field
  summaries, queued-write feedback, and the scientific meaning of every chart.

## Adaptive layout

- At 1200px and above, retain the grouped sidebar. Below that, retain the existing
  five-slot navigation and native More disclosure.
- Below 700px, show compact workflow labels, while accessible names include both
  compact and full labels. Put the operator in its own row; group synchronization
  feedback, language, and account controls below it in document order.
- The account disclosure contains the full email, role, and sign-out action.
  Its panel fits within the viewport. Sign-out keeps its existing queue checks.
- The sign-in screen pairs institutional artwork with a form on desktop. On
  smaller screens, show a short introduction and stack the form; omit the artwork.
- Keep the existing two-column tablet forms and plate/editor arrangement. At
  phone widths, retain the existing plate/editor switching. Short windows use
  normal-flow confirmation controls.
- Allow local table scrolling inside labelled regions; the page must fit the
  viewport. Preserve reduced motion, text scaling, route focus, and print rules.

## Deliberate limits

No new runtime dependency, dark theme, marketing carousel, parallax, backend
change, or navigation framework. Authentication, authorization, offline queues,
report calculations, and data persistence use the existing implementation.
See `docs/design/kuvacb-redesign-v2/README.md` for validation and screenshots.

## Approved motion extension (2026-10-11)

Dashboard/sign-in feature panels use deep teal (#004b4b → #003d3e), readable
off-white text (#f4f6ed), sage secondary text (#d5e7df), and a light lime action
surface (#d5da83) with the existing dark ink. The application canvas stays light.
Original optical biological artwork is decorative and does not represent
experimental data. Dashboard artwork is static and has no caption or motion
controls, following user review. Sign-in artwork/light motion has a pause control, stops offscreen
and in hidden tabs, and becomes static under reduced motion. Work surfaces use
brief 180–220ms feedback; status colors retain their original meaning.

Survival charts retain step geometry, uncertainty, accessible point navigation
and source tables. Legend values identify each group's last known survival.
Counts/percentages stay separate from bar tracks; unknown data stays unknown.
Process summaries use ordered step cards with API counts/percentages and qualified
transition context. Fish status/age/sex are visible in modular panels; box cards
show counts, not capacity or measured density. Saved feedback may display a short
check; pending or syncing work must never use that success indicator.
See `docs/design/kuvacb-motion-plan/README.md` for delivered scope and checks.

## Laboratory workspace refinement

Work pages use compact headings, aligned metadata and unified search/filter
surfaces. Checkpoint plate/editor layouts prioritize the plate on phones; bulk
tools open deliberately and preserve unsaved work. A disabled confirmation bar
stays in normal flow, with sticky placement only when actionable. Member access
and master-data creation forms use native disclosures; account risk information
stays visible and unsaved access edits remain marked. No status-color animation
or new decorative artwork is added to these data-entry pages.
See `docs/design/kuvacb-workspace-polish/README.md` for scope and validation.
