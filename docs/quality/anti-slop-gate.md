# Anti-Slop Delivery Gate: dashboard phase 1

- Scope: `apps/web` (sign-in, first-run setup, overview, projects, project detail with tasks,
  activity, code and settings tabs, task detail, connections, approvals, notifications, settings).
- Rules: Anti-Slop 3.2.25 core `docs/antislop/antislop.md` plus the `antislop-ui`,
  `antislop-human`, `antislop-layoutmobile` and `antislop-copywriting` skills in
  `docs/antislop/skills/` (`docs/antislop/VERSION`).
- Mode: During, chosen by the owner for this session.
- Direction: `DESIGN.md`.
- Design Read: a developer operations console for solo makers and small teams, in a decision-ledger
  visual language, dial ENERGY 1 / RHYTHM 2 / MOTION 1.
- Date: 2026-11-05.

## Evidence

| Evidence                      | Command                                                    | Result                                                                          |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Click-through, dev server     | `pnpm --filter @quorumloop/web e2e` with `pnpm dev:core`   | 3/3 passed, 0 console errors, log in `docs/quality/clickthrough-log.md`         |
| Click-through, Compose build  | same, with `QUORUMLOOP_WEB_URL=http://127.0.0.1:8080`      | 3/3 passed, 0 console errors, log in `docs/quality/clickthrough-log-compose.md` |
| Accessibility                 | axe-core (WCAG 2.0/2.1/2.2 A and AA), 11 scans, 10 screens | 0 violations on every scan; the overview is scanned in light and dark           |
| Contrast, every token pairing | `pnpm --filter @quorumloop/web test` (`contrast.test.ts`)  | 40 pairings pass in light and dark; formula from `antislop-human`               |
| Transition table drift        | `pnpm --filter @quorumloop/web test` (`domain.test.ts`)    | client copy matches `task.rules.ts`                                             |
| Screenshots                   | `docs/quality/screenshots/`                                | overview light and dark, board, board and composer sheet at 360px, menu dark    |

The click-through logs one line per control: which element, what it did, and the axe result per
screen. The only console message excluded is the 401 a signed-out session probe and a wrong
password produce by design; every other console error fails the run.

## Block 1: Hard Gate

| Rule | Result | Evidence                                                                                                                                                                                                                                       |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-02 | PASS   | `grep -rn "—" apps/web/src apps/web/index.html` finds 0                                                                                                                                                                                        |
| R-03 | PASS   | 360px run: `scrollWidth` 360 on overview, projects, connections, approvals, notifications, settings and the project board. The rail becomes a labelled Menu dialog; the composer becomes a 44px dock plus bottom sheet; Menu button 44px high  |
| R-17 | PASS   | every figure comes from a service response; Quality passed and Active agents read Unavailable because their services are scaffolds, and a figure whose service failed its health probe reads Unavailable instead of the gateway's 0            |
| R-18 | PASS   | no testimonials                                                                                                                                                                                                                                |
| R-23 | PASS   | no logo or avatar was created: the brand is the product name set in the display serif (the honest placeholder R-23 names); navigation follows `DESIGN.md` section 11, limited to built screens                                                 |
| R-24 | PASS   | the rail links only Overview, Projects, Connections, Approvals, Notifications, Settings; each one was clicked and reached its page                                                                                                             |
| R-25 | PASS   | `contrast.test.ts`; axe colour-contrast clean in both themes after the fix noted below                                                                                                                                                         |
| R-26 | PASS   | every button in the log performs its action; disabled controls carry their reason in `title` and adjacent text (Save policy with no change, Archive before the checkbox, Move before a lane is picked)                                         |
| R-27 | PASS   | every data view has loading (skeleton rows with a status label), empty (cause plus the one action) and error (reason, correlation id, Retry, or an access message on 403)                                                                      |
| R-28 | PASS   | no FAQ                                                                                                                                                                                                                                         |
| R-32 | PASS   | skip link is the first Tab stop; one `:focus-visible` rule (2px accent, 2px offset); native `<dialog>` closes on Escape, verified for Start from idea, Connect GitHub, Menu and the composer sheet                                             |
| R-33 | PASS   | no patch scripts; theming is CSS custom properties switched by `html[data-theme]`                                                                                                                                                              |
| R-34 | PASS   | dark theme toggled from the strip and from the mobile menu; axe clean in dark                                                                                                                                                                  |
| R-35 | PASS   | both builds were run and clicked through (logs above)                                                                                                                                                                                          |
| R-36 | PASS   | no security, compliance or performance claims in the UI                                                                                                                                                                                        |
| R-37 | PASS   | `DESIGN.md` loaded before any UI code; one token added there (`--rule-strong`) with its reason                                                                                                                                                 |
| R-38 | PASS   | the only placeholder text is `https://gitlab.example.com` in the GitLab URL field                                                                                                                                                              |
| R-39 | PASS   | `cursor: pointer` set once in the base layer; actions are `<button>`, navigation `<a href>`; every field has a visible `<label>`; `<html lang="en">`, unique `<title>`, `header`/`nav`/`main` landmarks, one `h1` per screen; zoom not blocked |
| R-40 | PASS   | the dashboard ships no images, video, iframes or third-party scripts; no performance number is reported because none was measured                                                                                                              |

## Block 2: Purpose-Gate

| Rule | Result | Reason written down                                                                                                                                                      |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R-01 | PASS   | the only `linear-gradient` draws the round rule's ticks (`DESIGN.md` section 2); no colour gradients                                                                     |
| R-04 | PASS   | no icons; status uses a 6px square plus a text label (`DESIGN.md` section 3)                                                                                             |
| R-06 | PASS   | serif display, system UI body, monospace only for ids, SHAs, counts and timestamps, each with its reason in `DESIGN.md` section 4                                        |
| R-07 | PASS   | no background pattern                                                                                                                                                    |
| R-08 | PASS   | no arrows on buttons; the one `→` is data notation between a pull request's source and target branch                                                                     |
| R-09 | PASS   | no badges; status labels mark real states produced by a service                                                                                                          |
| R-10 | PASS   | no blur                                                                                                                                                                  |
| R-12 | PASS   | `--elevation` on dialogs only (they float above the page); the active rail item uses an inset 2px accent edge to mark the current page, which is a state, not decoration |
| R-13 | PASS   | no glow                                                                                                                                                                  |
| R-14 | PASS   | no feature cards; Kanban lanes are fixed 288px columns by design and hold task rows, not cards                                                                           |
| R-19 | PASS   | MOTION 1: 120ms border-color and opacity transitions only, removed under `prefers-reduced-motion`; nothing enters with an animation                                      |
| R-22 | PASS   | no illustrations                                                                                                                                                         |

## Block 3: Liveliness

| Check                      | Result | Evidence                                                                                                                                              |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dials set                  | yes    | ENERGY 1 / RHYTHM 2 / MOTION 1 from `DESIGN.md`                                                                                                       |
| Output matches the dials   | yes    | calm palette and type; RHYTHM 2 shows as a KPI strip, a ledger table and a feed on the overview, and lanes plus a docked composer on the project view |
| One focal point per screen | yes    | the accent fill marks one decision per screen: Create project, Send instruction or Write instruction, Save policy, Connect GitHub, Sign in            |
| Structural whitespace      | yes    | 4 to 64px scale; 32px between sections, 16px inside blocks                                                                                            |
| One deliberate accent      | yes    | brick `--accent` on the primary action, links, focus ring and current-page marker only                                                                |
| Identity motif             | yes    | the round rule under every page title, plus monospace columns for ids and hashes                                                                      |
| Design Read declared       | yes    | top of this file                                                                                                                                      |

## Block 4: Craftsmanship and Quality Locks

| Check | Result | Evidence                                                                                                                                                             |
| ----- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-1   | PASS   | every visual choice traces to `DESIGN.md`; the departures are recorded here and in `DECISIONS.md` D-15                                                               |
| C-2   | PASS   | see R-26                                                                                                                                                             |
| C-3   | PASS   | no section exists to fill a template: the overview drops the "agent lanes" section from `DESIGN.md` because no agent sessions exist, and says so in one line instead |
| C-4   | PASS   | states, both themes, 360px and keyboard checked as above                                                                                                             |
| C-5   | PASS   | see R-17 and R-36                                                                                                                                                    |
| R-05  | PASS   | no hero, card grid or template footer; the shell is the rail, strip and content layout `DESIGN.md` section 6 specifies                                               |
| R-11  | PASS   | 2px controls, 3px panels, 0 table rows, 6px dialogs; no pills                                                                                                        |
| R-15  | PASS   | buttons name action and object (`Create project`, `Send instruction`, `Sync repository`, `Archive <name>`); none of the generic CTAs                                 |
| R-16  | PASS   | buzzword scan finds 0                                                                                                                                                |
| R-20  | PASS   | warm paper, brick accent, serif headings and the round rule carry the identity without the name                                                                      |
| R-21  | PASS   | light default for daytime operator work, working dark toggle (`DESIGN.md` section 3)                                                                                 |
| R-29  | PASS   | two neutrals plus one accent; the five state colours are functional signals defined in `DESIGN.md`                                                                   |
| R-30  | PASS   | not modelled on another product                                                                                                                                      |
| R-31  | PASS   | reasons are in `DESIGN.md` sections 2 to 10 and in the Purpose-Gate table above                                                                                      |

## Defects found by the gate and fixed before this PASS

1. Dark theme `--rule-strong` (#5D666B) was 2.82:1 on the surface, under the 3:1 non-text minimum.
   Found by `contrast.test.ts`, raised to #687176 (3.32:1) and recorded in `DESIGN.md`.
2. Buttons animated `background-color`, which `DESIGN.md` section 7 does not allow; axe caught a
   mid-transition contrast failure after the theme toggle. Transitions are now border-color and
   opacity only.
3. The project board widened the page to 929px at 360px: visually hidden labels inside the lanes
   escaped the scroll container. `.board-scroll` is now their containing block.
4. At 360px the docked composer covered the board. It is now a 44px dock button and a bottom sheet,
   as `DESIGN.md` section 6 specifies.
5. The strip brand was hidden on phones by a rule order bug, and theme and sign-out crowded the strip;
   both moved into the Menu dialog.
6. Two accent-filled buttons competed on the project view; Create task is now a secondary button.
7. Saving an unchanged policy produced a server error. The form sends only changed fields and
   disables Save until something changes.

## Not covered

- The `antislop-human` contrast script was not executed: the session's command policy blocked
  running a downloaded script. The same WCAG formula runs as `contrast.test.ts` instead.
- No screen reader session (NVDA, VoiceOver) was recorded; landmarks, names and live regions were
  checked by axe and by reading the markup.
- 200% zoom and forced-colors mode were not exercised.
- Lighthouse and Core Web Vitals were not measured.
- No reviewer independent of the implementing agent ran this gate (PRD section 12).

Verdict: PASS for the screens listed in Scope.

---

# Anti-Slop Delivery Gate: project page

- Scope: `apps/site/index.html` (one page: masthead, hero with screenshot, the loop, what runs
  today, rules the code enforces, quickstart, footer).
- Rules: Anti-Slop 3.2.25 core plus `antislop-ui`, `antislop-copywriting`, `antislop-human` and
  `antislop-layoutmobile`. Mode: During.
- Direction: `DESIGN.md` section 13. Design Read: a project page for developers evaluating a
  self-hosted tool, in the decision-ledger language, dial ENERGY 2 / RHYTHM 2 / MOTION 1.
- Date: 2026-11-05.

## Evidence

| Evidence      | Command                                                                    | Result                                                                       |
| ------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Click-through | `pnpm --filter @quorumloop/site e2e` against `vite preview` on 4174        | 2/2 passed, 0 console errors, log in `docs/quality/clickthrough-log-site.md` |
| Accessibility | axe-core WCAG 2.0/2.1/2.2 A and AA                                         | 0 violations on 4 scans: desktop light and dark, 360px light and dark        |
| Token drift   | `pnpm --filter @quorumloop/site test`                                      | colours equal the dashboard's, so `apps/web` `contrast.test.ts` covers them  |
| Screenshots   | `docs/quality/screenshots/site-light.png`, `site-dark.png`, `site-360.png` | full page in each                                                            |

## Block 1: Hard Gate

| Rule | Result | Evidence                                                                                                                                                                |
| ---- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-02 | PASS   | `grep "—"` over `apps/site/index.html` and `src` finds 0                                                                                                                |
| R-03 | PASS   | 360px: `scrollWidth` 360 in both themes; every nav link inside the viewport; nav, theme and hero buttons 44px or taller; the quickstart block scrolls inside its panel  |
| R-17 | PASS   | the only numbers are service counts (10 of 20), ports and lane numbers, all from README and the service catalogue                                                       |
| R-18 | PASS   | no testimonials                                                                                                                                                         |
| R-23 | PASS   | no logo created: the wordmark is the product name in the display serif; the only images are real screenshots                                                            |
| R-24 | PASS   | nav holds three in-page anchors and the GitHub repository; each was clicked                                                                                             |
| R-25 | PASS   | page uses the dashboard tokens (drift test) whose pairings `contrast.test.ts` proves; axe colour-contrast clean in both themes                                          |
| R-26 | PASS   | every link and button did its action in the log; no dead control                                                                                                        |
| R-27 | N/A    | the page displays no fetched data; the copy button has a success and a failure message                                                                                  |
| R-28 | PASS   | no FAQ                                                                                                                                                                  |
| R-32 | PASS   | skip link is the first Tab stop and moves focus to `main`; the scrollable code block is focusable; one `:focus-visible` rule                                            |
| R-33 | PASS   | no patch scripts                                                                                                                                                        |
| R-34 | PASS   | both themes clicked through and scanned; the screenshot swaps with the theme                                                                                            |
| R-35 | PASS   | built and clicked through (log above)                                                                                                                                   |
| R-36 | PASS   | no security, compliance, performance or customer claims; status states agents do not run yet                                                                            |
| R-37 | PASS   | `DESIGN.md` section 13 written before the page                                                                                                                          |
| R-38 | PASS   | every claim is copied from README or `KNOWN_LIMITATIONS.md`; the screenshot caption says its projects are test data                                                     |
| R-39 | PASS   | `cursor: pointer` once in base; `lang`, unique `<title>`, `header`/`nav`/`main`/`footer`, one `h1`, no skipped levels; both images have `alt`; zoom not blocked         |
| R-40 | PASS   | both images carry `width` and `height`; the light hero image is eager with `fetchpriority="high"`; no third-party script; no performance number reported (not measured) |

## Block 2: Purpose-Gate

| Rule | Result | Reason                                                                                           |
| ---- | ------ | ------------------------------------------------------------------------------------------------ |
| R-01 | PASS   | the only gradient draws the round rule's ticks                                                   |
| R-04 | PASS   | no icons; 6px state squares with text                                                            |
| R-06 | PASS   | serif display, system body, monospace only for commands, ports and lane numbers                  |
| R-07 | PASS   | no background pattern                                                                            |
| R-08 | PASS   | no arrows                                                                                        |
| R-09 | PASS   | no badges; the status line is a sentence                                                         |
| R-10 | PASS   | no blur                                                                                          |
| R-12 | PASS   | no shadows                                                                                       |
| R-13 | PASS   | no glow                                                                                          |
| R-14 | PASS   | no feature cards; the loop columns are a sequence with different content per lane                |
| R-19 | PASS   | MOTION 1: 120ms border-color and opacity, smooth anchor scroll; all removed under reduced motion |
| R-22 | PASS   | no illustrations                                                                                 |

## Block 3: Liveliness

| Check           | Result | Evidence                                                                                                                                                                          |
| --------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dials           | yes    | ENERGY 2 / RHYTHM 2 / MOTION 1, `DESIGN.md` section 13                                                                                                                            |
| Output matches  | yes    | energy comes from the 64px serif H1 only; sections alternate paper and surface bands and change composition (columns, split with table, text beside a mono list, split with code) |
| One focal point | yes    | the H1, then one accent button (Read the self-host steps)                                                                                                                         |
| One accent      | yes    | brick on the primary button and links only                                                                                                                                        |
| Identity motif  | yes    | the round rule under the H1, monospace columns for ports                                                                                                                          |

## Block 4: Craftsmanship and Quality Locks

| Check            | Result | Evidence                                                                                                      |
| ---------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| C-1, R-31        | PASS   | each decision has a reason in `DESIGN.md` section 13                                                          |
| C-2              | PASS   | see R-26                                                                                                      |
| C-3              | PASS   | sections follow the product's facts: what it is, how a task moves, what works, how it is built, how to run it |
| C-4              | PASS   | both themes, 360px, keyboard and clipboard failure path                                                       |
| C-5              | PASS   | see R-17, R-36                                                                                                |
| R-05             | PASS   | no hero plus three cards, no logo bar, no stats row, no three-step how-it-works, no template footer           |
| R-11             | PASS   | 2px controls, 3px panels and images                                                                           |
| R-15             | PASS   | CTAs name the action: Read the self-host steps, Read the source, Copy commands                                |
| R-16             | PASS   | buzzword scan finds 0                                                                                         |
| R-20, R-29, R-30 | PASS   | the dashboard's palette and type; not modelled on another product                                             |
| R-21             | PASS   | light default with a working dark toggle, stored per browser                                                  |

## Defects found and fixed before this PASS

1. In the light theme both hero screenshots were visible: `.shot img` outranked `.shot-dark`. Fixed
   and now asserted by the click-through.
2. At 360px the horizontally scrolling nav cut "Source on GitHub" off. The links now wrap.
3. The quickstart block scrolled but could not take focus (axe `scrollable-region-focusable`).

## Not covered

- No screen reader session, 200% zoom or forced-colors run; no Lighthouse measurement.
- No reviewer independent of the implementing agent.
- The page is not published, so it was checked on `vite preview` only.

Verdict: PASS for the project page.
