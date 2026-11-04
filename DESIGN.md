# Quorumloop Design Direction

Status: active. This file is the visual authority for the Quorumloop dashboard.
Filter: official Anti-Slop core (`docs/antislop/antislop.md`, pinned 3.2.25, MIT) plus the
UI, human, mobile and copywriting skills. Anti-Slop removes slop; this file supplies direction.

Design Read: **a developer operations console for solo makers and small teams, in a
decision-ledger visual language, dial ENERGY 1 / RHYTHM 2 / MOTION 1.**

---

## 1. What the product is, in visual terms

Quorumloop is not a landing page, a marketing site, or an "AI dashboard". It is an operator
console: a place where a person checks which repository changed, which agent holds a task
lease, what a quality gate actually proved, and what to do next. The interface must read
like a well-kept engineering record: dense, ordered, and honest.

Three consequences drive every decision below:

1. **Records over decoration.** Rows, rules, and aligned columns carry the page. Decorative
   surfaces compete with status reading, so they are absent.
2. **Truth over momentum.** A number appears only when a service returned it. A status word
   appears only when a state machine produced it. Anything else renders as `Unavailable`,
   `Not connected`, or `Stale`.
3. **One focal point per screen.** The thing the operator came to do (send an instruction,
   clear a blocker, connect a forge) owns the visual weight. Everything else defers.

## 2. Identity motif: the round rule

The product name joins two ideas: a quorum (a recorded decision) and a loop (repeated
rounds of work). The motif is a single horizontal rule under the page title carrying evenly
spaced 8px ticks. It is used **once per screen**, directly under the page heading, and
nowhere else.

Reason: it separates page identity from page content the way a ledger separates a heading
from its entries. Used once it is a signature; repeated it would become texture, which is
why it is capped.

Secondary motif: identifiers, SHAs, timestamps and counts are set in the monospace face so
that columns align when scanned vertically. This is a working requirement, not a style.

## 3. Color

Two core colors plus one accent, with neutrals. Semantic state colors are functional
signals, not part of the brand palette.

### Light theme (default for daytime operator work)

| Token            | Value     | Use                                       | Reason                                                                    |
| ---------------- | --------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| `--paper`        | `#F3F0E8` | app background                            | warm low-glare paper separates the console from glare-white AI dashboards |
| `--surface`      | `#FBF9F4` | panels, table body                        | one step lighter than paper so panels read as inserted sheets             |
| `--ink`          | `#171B1D` | primary text                              | 15.9:1 on paper                                                           |
| `--ink-muted`    | `#545C60` | secondary text, labels                    | 6.4:1 on paper, still quiet                                               |
| `--rule`         | `#D6D0C2` | 1px dividers                              | visible structure without shadows                                         |
| `--accent`       | `#8F3512` | primary action, active marker, focus ring | brick reads as "human decision", distinct from blue tool defaults         |
| `--accent-hover` | `#712A0E` | hover/pressed                             | deeper, never lighter                                                     |
| `--accent-ink`   | `#FFF8F2` | text on accent fill                       | 8.4:1 on accent                                                           |

### Dark theme (opt-in, full parity)

| Token            | Value     | Use                        |
| ---------------- | --------- | -------------------------- |
| `--paper`        | `#14171A` | app background             |
| `--surface`      | `#1B1F23` | panels                     |
| `--ink`          | `#E8E2D6` | primary text               |
| `--ink-muted`    | `#A5ADA8` | secondary text             |
| `--rule`         | `#2E353A` | dividers                   |
| `--accent`       | `#E07A45` | primary action, focus ring |
| `--accent-hover` | `#EE8D5B` | hover                      |
| `--accent-ink`   | `#1B1108` | text on accent fill        |

### Semantic states (all themes, always paired with a text label)

| State  | Light     | Dark      | Meaning                          |
| ------ | --------- | --------- | -------------------------------- |
| `pass` | `#35603F` | `#8FBE96` | check passed with evidence       |
| `run`  | `#1F5169` | `#7FB6CE` | work is actually in progress     |
| `wait` | `#7A5312` | `#D9A85C` | waiting on a human or a cooldown |
| `fail` | `#8A2B2B` | `#E49494` | failed, blocked, or unsafe       |
| `idle` | `#545C60` | `#A5ADA8` | known but not active             |

Status markers are 6px squares next to a text label. The square is not decorative: shape
plus label survives color blindness and monochrome printing. No glowing dots, no gradients.

Reason for the palette: brick red is the accent a person uses when making a recorded
decision (approve, send, stop). Blue is the default of every developer tool, so it gives no
identity, and blue-purple gradients are rejected outright by Anti-Slop R-01.

## 4. Typography

| Role                                | Stack                                                                                     | Reason                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Display, H1 to H3                   | `"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif`                  | a ledger voice for headings, immediately distinct from tool-default sans headings; no webfont download |
| UI, body                            | `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`       | native rendering, zero network cost, familiar to operators                                             |
| Data, IDs, SHAs, timestamps, counts | `ui-monospace, "Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace` | fixed advance keeps hashes, ids, and durations aligned; prevents 0/O and 1/l misreads                  |

Scale: 12, 13, 14, 16, 20, 26, 34 px. Body is 14px with 1.5 line-height; tables 13px with
1.35 line-height; page H1 is 26px serif; section H2 is 18px serif. Numerals are tabular in
data cells. Labels are 11px sans, sentence case, no wide tracking, no uppercase shouting.

Reason against a mono headline: R-06. Monospace earns its place only where column
alignment carries meaning.

## 5. Spacing, density, radius, elevation

Scale: 4, 8, 12, 16, 24, 32, 48, 64. Page gutter 24px desktop, 16px mobile. Section gap 32px,
block gap 16px, inline gap 8px.

Density: table row 40px, compact row 34px, control height 32px (36px on mobile), panel padding
16px. Density is a feature: an operator compares eight repositories at once.

Radius: 2px controls, 3px panels, 0 on table rows, 6px dialogs only. No pill shapes.

Elevation: one level, used only by dialogs and popovers because they float above the page.
Everything else uses 1px rules. No card shadows.

## 6. Layout

- **Shell**: 232px left rail, 56px top strip, content area with 24px gutter and a 1440px cap.
  The rail collapses to a horizontal section scroller below 900px and to a menu dialog below
  640px.
- **Top strip**: breadcrumb path on the left in mono, then instance health, sync time, theme
  toggle, account. The right side never grows into a toolbar of icons.
- **Overview**: KPI row as a rule-separated strip (label above, mono number below), then the
  project ledger table, then agent lanes, then alerts. No card grid.
- **Project detail**: title block with forge and branch in mono, tab bar as underlined text,
  then the tab body. The instruction composer is docked at the bottom of the content area and
  stays reachable on every tab.
- **Kanban**: six fixed lanes of 288px, horizontal scroll on narrow screens with a visible
  scroll affordance and keyboard-reachable cards. Task rows carry id, title, dependency count,
  agent, and quality state. No glossy cards.
- **Agent fleet**: one row per session with engine, runtime, project, task, last heartbeat,
  and a stale marker when the heartbeat is older than the lease interval.
- **Mobile (360px)**: single column, the composer becomes a bottom sheet with a 44px target,
  tables become stacked definition rows with labels, no horizontal page overflow. Kanban is
  intentionally scrollable, not compressed.

## 7. Components and states

Every data surface ships with: loading (skeleton rows matching final row geometry), empty
(one sentence explaining what will appear and the single action that creates it), error
(reason, retry, correlation id), offline/degraded banner, permission-denied explanation,
stale timestamp, partial sync marker, and long-running progress with a cancel affordance
where the backend supports cancel.

Controls: buttons are `button` elements with verb labels; navigation is `a[href]`; destructive
actions require an inline confirmation with the object name typed nowhere (a checkbox and a
named confirm button). Disabled controls carry a visible reason in `title` and adjacent text
when the reason is not obvious.

Focus: 2px accent outline with 2px offset, never removed. `prefers-reduced-motion` removes all
transitions. Motion is limited to 120ms opacity and border-color changes on hover, focus,
expand. Nothing enters with an animation.

## 8. Copy voice

Plain, technical, second person, present tense. Short sentences. The interface says what
happened and what the operator can do. No em dash, no buzzwords ("seamless", "powerful",
"AI-powered"), no exclamation marks, no rhetorical questions.

- Buttons name the action and object: `Import repository`, `Create task`, `Send instruction`,
  `Stop agent`, `Reconnect GitLab`.
- Honest states: `Not connected`, `Installed, needs authentication`, `Rate limited until 14:32`,
  `All candidates unavailable`, `Unavailable`, `Stale, last synced 12 minutes ago`.
- Numbers always carry a source or appear as `Unavailable`. Demo datasets are labelled
  `Demo` in the shell, in every panel header, and in exported reports.

## 9. Accessibility contract

- WCAG 2.2 AA contrast for all text in both themes; verified on the token pairs above.
- Full keyboard path: skip link, rail, tables, tabs (arrow keys), dialogs (Escape, focus trap,
  focus return), composer (Enter sends, Shift+Enter newline).
- Landmarks: `header`, `nav`, `main`, `footer`; one `h1` per page; no skipped levels.
- Live regions: agent stream updates announced through a polite live region with a rate cap,
  never one announcement per token.
- Minimum target 44px on touch, 32px on pointer devices.
- No information conveyed by color alone; every state has a text label.

## 10. Rejected patterns (for this product specifically)

Fake KPIs, decorative status dots, glow, gradients, glassmorphism, bento grids, sparkle or
robot icons, fake terminals, invented token counts or costs, "AI-powered" badges, pill
buttons, animated counters, dark-mode-by-default because it looks technical, marketing hero
sections inside the app, and any control without a real backend action.

## 11. Page inventory the direction must cover

Sign in, first-run setup, overview, all projects, import repository wizard, start from idea,
project detail (overview, tasks, agents, code, reviews, roadmap, activity, quality, settings),
revision composer, agent detail, provider priorities, runs, approvals, quality reports,
usage, settings, open-source acknowledgements, demo mode banner.

## 12. Delivery Gate record

The gate is run at the end of each UI phase and recorded in `docs/quality/anti-slop-gate.md`
with evidence per item. A gate with any FAIL is not shipped.
