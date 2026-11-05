# Dashboard click-through log

Recorded by `apps/web/e2e/clickthrough.spec.ts` on 2026-11-04T16:54:55.391Z against the live
gateway. Regenerate with `pnpm --filter @quorumloop/web e2e` while `pnpm dev:core` runs.

- axe sign in: 0 violations
- Sign in with a wrong password -> inline alert "email or password is incorrect"
- Sign in with SMOKE_EMAIL -> Overview
- Overview -> KPI strip shows Quality passed and Active agents as Unavailable, not 0
- Overview Refresh -> refetches, button returns to Refresh
- axe overview (light): 0 violations
- Rail Projects -> Projects page
- Rail Connections -> Connections page
- Rail Approvals -> Approvals page
- Rail Notifications -> Notifications page
- Rail Settings -> Settings page
- Rail Overview -> Overview page
- Dark theme toggle -> html[data-theme=dark], button reads Light theme
- axe overview (dark): 0 violations
- Light theme toggle -> back to light
- Start from idea -> dialog opens, Escape closes it
- axe projects: 0 violations
- Create project dialog -> slug follows the name
- Create project -> navigates to the new project "Clickthrough mw2cxd0o"
- Create task -> task appears in the Backlog lane
- Move to Ready -> task moves to the Ready lane
- axe project board: 0 violations
- Task page -> in progress, in review, then Done is refused with the quality gate reason
- Save task -> "Saved."
- History table -> lists the transitions
- axe task detail: 0 violations
- Composer Enter -> instruction recorded, dispatch reads Not dispatched with the server reason
- Activity tab -> stream status Live, feed lists real events
- axe activity: 0 violations
- Code tab -> empty state names the missing repository and links to Connections
- Save project settings -> "Saved."
- Archive is disabled until the checkbox is ticked, then archives and returns to Projects
- Connect GitHub with an empty token -> browser validation blocks submit
- Connect dialog Close -> closes
- axe connections: 0 violations
- Approvals tab Approved -> selected, list reloads
- axe approvals: 0 violations
- axe notifications: 0 violations
- Notifications -> list or empty state renders
- Save policy with no change -> disabled, "No unsaved changes."
- Change audit retention, Save policy -> "Saved as a new revision."
- Restore audit retention to 366 -> saved again
- axe settings: 0 violations
- First Tab -> Skip to content link receives focus
- Unknown URL -> Page not found with a link to the overview
- Sign out -> back to Sign in
- 360px overview: scrollWidth 360 vs viewport 360
- 360px projects: scrollWidth 360 vs viewport 360
- 360px connections: scrollWidth 360 vs viewport 360
- 360px approvals: scrollWidth 360 vs viewport 360
- 360px notifications: scrollWidth 360 vs viewport 360
- 360px settings: scrollWidth 360 vs viewport 360
- 360px project board (lanes scroll inside their own container): scrollWidth 360 vs viewport 360
- 360px composer -> 44px dock button opens a bottom sheet, send records the instruction, Escape closes
- 360px Menu -> section dialog opens
- 360px Menu theme button -> toggles dark and back to light
- 360px Menu > Projects -> navigates and the dialog closes
- 360px Menu button height 44px (minimum 44)

Console errors: 0
