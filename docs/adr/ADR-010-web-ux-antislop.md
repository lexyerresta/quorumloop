# ADR-010: Web experience direction (Anti-Slop)

- **Status:** Accepted
- **Date:** 2026-11-04
- **Context:** Quorumloop is an operations console for people supervising autonomous agents. The dashboard must convey state, evidence and risk quickly, and must not read as a generic AI-generated dashboard. Anti-Slop rules are mandatory from the first screen.
- **Decision:** `DESIGN.md` is the visual authority; `docs/antislop/antislop.md` is the rule set.
  - Design Read: developer operations console for solo makers and small teams, in a decision-ledger visual language; ENERGY 1, RHYTHM 2, MOTION 1.
  - Warm paper ground, near-black ink, a single brick accent used only for authoritative actions and live state. Serif display headings, system sans for UI, mono for identifiers, timestamps and diffs.
  - Rows and rules instead of floating cards; a left rail, a 56px top strip, a 232px density that fits six Kanban lanes at 1440px. Light and dark have full parity.
  - Every screen ships loading, empty, error, offline, degraded, stale and partial-sync states. No skeleton that lasts forever, no optimistic number that is not real.
  - Accessibility contract: WCAG 2.2 AA, visible focus, keyboard-first, 44px touch targets on mobile, no colour-only meaning.
  - Demo data is labelled in the interface, not only in the API.
- **Consequences:**
  - Components are built from tokens, so a change of direction is a token change, not a rewrite.
  - A UI deliverable is not done without the four-block Delivery Gate review recorded in `PROGRESS.md`.
  - Rejected decorative patterns (gradient heroes, glassmorphism, floating pill dashboards, emoji status) are documented so reviewers can name them.
- **Rejected:** a component library default theme (looks generic), a dark-only developer aesthetic (harder for long triage sessions), charts before data integrity.
