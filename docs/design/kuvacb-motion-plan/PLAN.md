# KUVACB — motion and visual direction

Status: approved on 2026-10-11. This records the approved direction; see README.md for the implemented scope and verification.

## Direction

Create the feeling of a sophisticated biological research observatory. Keep KUVACB teal (#006664), lime (#b2bb1e), Prompt headings and Noto Sans Thai body text. Concentrate spectacle in the Dashboard welcome area and login visual; give work screens precise, brief feedback. The original biological artwork is decorative, never a representation of live experimental results.

The accompanying concept.html demonstrates composition, a moving optical specimen, a light sweep, entrance timing and pause/reduced-motion behavior. It is an original direction study, not the final artwork or the implemented product.

## References examined

Reviewed multiple HeroInspo gallery screens and eight shortlisted detail pages; also visited the live Orakl, Titan Intake, Assemble and Linear sites. Navbar and CTA observations below are from gallery snapshots. Snapshot appearance and live website appearance can differ. Proposed motion timings are our choices, not claims about animations in static references.

| Reference | Specific observation | Adaptation for KUVACB |
| --- | --- | --- |
| [Orakl Oncology / HeroInspo](https://heroinspo.com/gallery/orakl-oncology) · [live](https://www.orakl-oncology.com/) | Large optical ring, glass-like biological imagery, dark depth; live site uses video and entrance animations. | Original specimen/lens composition with layered cells, fine optical edges and teal light. Strongest conceptual match to the research domain. |
| [Titan Intake / HeroInspo](https://heroinspo.com/gallery/titanintake) · [live](https://www.titanintake.com/) | Rounded inset hero, thin frame, blue/teal field, lime accents, asymmetrical copy and imagery. | Framed Dashboard hero on a warm light page; restrained teal/lime light movement inside the frame. |
| [Assemble / HeroInspo](https://heroinspo.com/gallery/onassemble) · [live](https://www.onassemble.com/) | Spacious typography surrounded by dimensional workflow objects. | A few custom research objects around the specimen; controlled entrances, ample space around Thai text. |
| [Linear / HeroInspo](https://heroinspo.com/gallery/linear) · [live](https://linear.app/) | Fine borders, softly lit icon surfaces and a precise product presentation. | Subtle material depth and short state transitions on navigation and clickable panels. |
| [Velt / Navbar Gallery](https://www.navbar.gallery/navbar/velt) | Clear grouping and separation of navigation, content and actions. | Retain current navigation hierarchy; refine selection indicator and operator panel motion. |
| [Orchid / Navbar Gallery](https://www.navbar.gallery/navbar/orchid) | Light inset menu surfaces and organized cards. | A crisp panel edge, soft shadow and compact opening transition. |
| [Tines / CTA Gallery](https://www.cta.gallery/cta/tines) | Bespoke patterned typography makes one action area memorable. | Original laboratory linework in the decorative area; a strong single primary action. Keep Thai headings solid and readable. |
| [Get Ripe / CTA Gallery](https://www.cta.gallery/cta/get-ripe) | Focused message, one strong action and a small hand-drawn accent. | Use a single intentional visual accent near a secondary welcome action where useful. |

## Page treatment

### Dashboard

- Desktop hero approximately 340–420px tall, with readable heading and actions on the left, optical specimen on the right. It must leave useful data visible below.
- Warm light page, deep teal hero, lime accents, thin inset frame and a soft optical highlight. Preserve official identity and existing useful content.
- Original artwork: layered biological forms, an optical rim and fine calibration marks. Avoid generic gradient blobs, random floating icons and invented dashboard numbers.
- On mobile stack text and a smaller visual, reduce layers and avoid pointer-dependent behavior. Keep actions immediately available.

### Login

- More cinematic version of the same artwork in the visual pane; light, calm form pane. Recompose the current institutional illustration where it contributes to the final identity.
- No entrance sequence delays form interaction, keyboard focus or error display.

### Work screens

- Navigation, operator panel, controls and feedback share a consistent motion vocabulary.
- Tables, specimen grids, plate wells and status colors remain visually stable during reading and data entry. Alive but abnormal remains yellow; dead remains red.
- Chart introductions follow real geometry and real data. No counting from zero, synthetic metrics or replaying an entrance after every filter change.

## Motion specification (initial tuning targets)

| Element | Proposed motion | Duration / limit |
| --- | --- | --- |
| Welcome composition | Copy and artwork enter with opacity and a small translation; no per-character Thai animation | 450–800ms total, 60–90ms stagger |
| Optical specimen | Slow depth movement and restrained light/color shift confined to artwork | 16–24s cycle; explicit pause control; stop offscreen or in hidden tabs |
| Hero background | Low-amplitude teal/lime illumination, leaving text and buttons on stable surfaces | Same slow cycle; no flashing or rapid hue changes |
| Navigation selection | Short indicator transition without moving neighboring layout | 150–220ms |
| Operator / menu panel | Fade and 4–6px translation; focus remains immediate | 180–220ms |
| Primary action | Surface highlight and 2–3px arrow movement on hover/focus; clear press feedback | 140–180ms; no perpetual button shimmer |
| Clickable cards | Small elevation change; static cards do not imply clickability | 140–180ms, up to 2px |
| New content / chart | Brief first entrance only where it assists hierarchy | 240–500ms; never block access to data |
| Save feedback | Brief success check alongside persistent, accurate status text | About 200ms; never imply a queued write has reached the server |

Honor [prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion): use a finished static composition and immediate state changes. Provide pause for ongoing decorative movement, following [W3C pause/stop/hide guidance](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html). On touch devices use simpler artwork and no cursor-following effect.

## Implementation after approval

1. **Approve the visual language:** refine original Dashboard/login artwork and desktop/mobile compositions. Review one implemented hero before broad rollout.
2. **Apply the direction:** hero and login first, then shared navigation, operator panel, buttons and restrained data presentation. Retain current React/CSS components and tokens; start with CSS/SVG and browser animation APIs rather than introducing a new UI framework.
3. **Verify and deliver:** check small screens, zoom, keyboard/focus, reduced motion, pause behavior, status semantics, offline/queued feedback and existing workflows; run relevant existing checks and rebuild the frontend Docker service when implementation is ready.

Use a compressed original rendered image plus light SVG layers if that achieves more convincing optical depth than pure CSS. A full WebGL scene is a separate decision only if the reviewed result needs it. Proposed additional first-screen artwork budget: approximately 400KB or less; measure actual assets and animation performance before delivery. Animate transforms/opacity where possible, avoid continuous large blur/filter changes, and reserve layout space to prevent shifting content.

## Approval scope

Approve the institutional teal/lime optical research direction, emphasis on Dashboard/login, and shared brief interactions. The prototype is a composition and motion study; final biological artwork, exact timing, asset size and device performance still require implementation and review.
