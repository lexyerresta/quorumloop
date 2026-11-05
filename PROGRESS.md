# Progress log

Newest first. Every entry states the command that produced it, so a reader can re-run the check
instead of trusting the text. Percentages are deliberately absent: they hide which part of the last
ten percent is the hard part.

## 2026-11-05: project page (`apps/site`)

- Built `apps/site`, a static project page requested by the owner (`DECISIONS.md` D-18, `DESIGN.md`
  section 13): what Quorumloop is, the task loop with what works today per lane, the status ledger,
  the rules the code enforces with the service list, and the quickstart with a copy button. The hero
  visual is the real overview screenshot from the dashboard click-through.
- Verified: `pnpm --filter @quorumloop/site build`, `lint`, `typecheck`, `test` (3, token drift
  against the dashboard) and `e2e` against `vite preview` (2/2: every link, theme toggle, reload,
  copy, 360px in both themes, axe 0 violations on 4 scans, no console errors). Log in
  `docs/quality/clickthrough-log-site.md`. Every external link answered 200 on the day.
- Fixed before delivery: both hero screenshots showed at once (a specificity bug the first
  click-through missed, now asserted), the masthead cut "Source on GitHub" off at 360px, and the
  scrollable quickstart block was not keyboard-focusable (axe `scrollable-region-focusable`).
- Not done: publishing. The page is local only.
- README: "Getting started" now offers the Docker path (`pnpm compose:core`, port 8080) beside the
  host path, and a new "Using the dashboard" section walks through first sign-in with the bootstrap
  token, connecting a forge, projects, the board, instructions and the other screens.

## 2026-11-05: dashboard (`apps/web`) and the Compose path

Environment: Windows 11, Node 26.13.0, pnpm 10.20.0, Docker Desktop 29.9.2 with PostgreSQL, NATS and
Redis on 127.0.0.1:5432, 4222 and 6379, Chromium from Playwright 1.64.1.

### What was built

- **`apps/web`**: React 19, Vite 8, TanStack Router and Query, typed against `@quorumloop/contracts`
  with type-only imports. Screens: sign-in, first-run setup, overview, projects (create, start from
  idea, import from a connection), project detail (Kanban with legal moves, activity over SSE, code,
  settings and archive), task detail (transitions with reasons, history, edit), connections
  (GitHub and GitLab connect, repository browser, import, remove), approvals, notifications and
  organization policy. Tokens and layout follow `DESIGN.md`; one token (`--rule-strong`) was added
  there for control borders.
- **Gateway serves the dashboard** from `WEB_DIST_DIR` (`services/api-gateway/src/static-web.ts`,
  6 tests): SPA fallback, strict CSP, path traversal guard, `/api` and `/health` never shadowed.
- **`apps/web/Dockerfile`** publishes the build into the `webdist` volume; a root `.dockerignore`
  keeps `node_modules`, build output and `.env` out of every build context.
- **Anti-Slop skills** 3.2.25 added under `docs/antislop/skills/` (fetched from the tagged release
  with the owner's permission, matched against the core's version).
- **Branch ruleset**: repository admins bypass `main` protection (`DECISIONS.md` D-14). Not applied
  to GitHub yet; `pnpm github:setup` needs the owner's token.

### Defects found and fixed on the way

- Every Dockerfile failed at `corepack enable` (exit 127): Node 26 images no longer ship corepack.
  All 21 now install pnpm with npm (`DECISIONS.md` D-16).
- In Compose the dashboard's health polling stalled the gateway: absent service names took 2 to 4 s
  to fail in Docker's DNS and exhausted libuv's four lookup threads, so sign-in and lists answered 503. Fixed with `QUORUMLOOP_DEPLOYED_SERVICES` and `UV_THREADPOOL_SIZE=32` (`DECISIONS.md` D-17);
  `/api/v1/health` went from 2.0 s to under 50 ms. `ServiceClient` errors now carry undici's cause.
- README told readers to run `corepack enable` and `pnpm setup`; the second is pnpm's built-in and
  never ran the project script. Both corrected in README and CONTRIBUTING.
- UI defects caught by the gate are listed in `docs/quality/anti-slop-gate.md`.

### Gates

| Command                                                     | Result                                               |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| `pnpm build`                                                | 25 of 25 tasks successful                            |
| `pnpm typecheck`                                            | 29 of 29 tasks successful                            |
| `pnpm lint --concurrency=2`                                 | 29 of 29 tasks successful                            |
| `pnpm test`                                                 | 29 of 29 tasks successful (web 46, gateway 9 tests)  |
| `pnpm test:contracts`                                       | 4 of 4 tasks successful                              |
| `pnpm format:check`                                         | all matched files use Prettier code style            |
| `pnpm smoke`                                                | 20 checks green against the host cluster             |
| `pnpm --filter @quorumloop/web e2e` against `pnpm dev:core` | 3 of 3 passed, 0 console errors, axe 0 violations    |
| same against `pnpm compose:core` on 8080                    | 3 of 3 passed, 0 console errors, 0 upstream failures |

### Not verified

- `pnpm compose:full` and `compose:demo` were not run.
- The click-through is not in CI: it needs a live stack and a browser download.
- No screen reader session, 200% zoom or forced-colors run (see the gate's "Not covered").

## 2026-11-04: repository settings kept as files

GitHub reads the About metadata, merge options and branch protection from its own settings, not from
the tree, so they were the one part of the project that existed only as clicks in a browser.

### What was added

- `.github/repo-settings.json` — description, 18 topics, feature flags, merge policy (squash only,
  delete the branch on merge, auto-merge allowed) and security toggles (Dependabot security updates,
  secret scanning and push protection, private vulnerability reporting).
- `.github/rulesets/main.json` — default-branch ruleset: no deletion, no force push, pull request
  required, `lint`/`types`/`test` required, branch must be up to date before merging.
- `scripts/github-setup.mjs`, run as `pnpm github:setup [--dry-run]` — applies both files through the
  REST API. It is idempotent (a ruleset is matched by name and updated in place), and a security
  toggle the plan or token cannot set warns instead of aborting the run.
- `DECISIONS.md` D-13 records why `dependencies` stays out of the required checks and why the approval
  count is zero.

### Gates

| Command                                   | Result                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm format` / `pnpm format:check`       | all matched files use Prettier code style                                                             |
| `pnpm lint --concurrency=2`               | 28 of 28 tasks successful                                                                             |
| `node scripts/github-setup.mjs --dry-run` | prints every call: repo patch, topics, security, private vulnerability reporting, ruleset read/create |

`pnpm lint` at the default concurrency died with exit `-1073740791` (`0xC0000409`) while the ten
service processes were running; the same command with `--concurrency=2` passed. That is a local
memory limit, not a lint failure, and it is reproducible only with the cluster up.

### Not verified

The script has never talked to the API with a real token: only `--dry-run` was run. The ruleset
cannot block anything until the three checks have reported at least once, which needs the CI workflow
to run on GitHub for the first time.

## 2026-11-04: settings, notification and audit services (Phase 1 close-out)

Environment unchanged: Windows, Node 24.12.0, pnpm 10.20.0, PostgreSQL, NATS and Redis in Docker on
127.0.0.1:55432, 4222 and 6379.

### What was built

- **settings-service** — `settings_policies` plus an append-only `settings_policy_revisions` table
  keyed by `(org_id, revision)`, so two concurrent admins fail loudly instead of overwriting history.
  `GET /api/v1/settings/policies` for members, `PUT` for `owner`/`admin` only; a write that changes
  nothing is rejected instead of creating a no-op revision.
- **audit-service** — the approval queue is materialized from `approval.required.v1` keyed by the
  producer's approval id, risk-ordered for the UI, and decided through
  `POST /api/v1/approvals/:id/decision`. A decision is final: a second decision returns `409`, an
  unknown id `404`, and the actor and note are stored with the decision.
- **notification-service** — an in-app inbox projected from `approval.required.v1` and
  `review.created.v1`, with per-member read state (`notification_reads`), an unread count and a
  bounded feed. `GET /api/v1/notifications`, `POST /api/v1/notifications/:id/read`,
  `POST /api/v1/notifications/read-all`.
- `notificationSchema`, `notificationFeedSchema` and a nullable `note` on `approvalSchema` in
  `@quorumloop/contracts`; gateway controllers for both new surfaces.

### Gates

| Command               | Result                                                                |
| --------------------- | --------------------------------------------------------------------- |
| `pnpm build`          | 24 of 24 tasks successful                                             |
| `pnpm lint`           | 28 of 28 tasks successful                                             |
| `pnpm typecheck`      | 28 of 28 tasks successful                                             |
| `pnpm test`           | 28 of 28 tasks, 137 tests across 11 packages, no failures             |
| `pnpm test:contracts` | 4 of 4 tasks, 5 contract tests                                        |
| `pnpm format:check`   | all matched files use Prettier code style                             |
| `pnpm db:migrate`     | applied `0001_init.sql` for settings, audit and notification          |
| `pnpm smoke`          | passed, 20 checks against a live 10-process cluster on 127.0.0.1:7001 |

The new tests: settings 12, audit 10, notification 8. Beyond unit tests, the three services were
driven live through the gateway with throwaway publishers that were deleted afterwards: 14 checks
against audit (materialization, unknown-action skip, queue order, filter, 401, approve, decided_by,
double decision 409, unknown id 404) and 16 against notification (two projected events, unread count,
severity, unknown action absent, replay produced no duplicate, mark-one, unread_only, read-all,
unknown id 404, anonymous 401).

### Defects found and fixed in this cycle

1. **The project activity rollup never worked.** `feed_projections` was empty after 20 events across
   5 projects. `ActivityRepository.append` passed a `Date` to a raw postgres.js parameter whose type
   the server infers from the insert target, and postgres 4 fails to encode it
   (`The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received
an instance of Date`). The row was written and the handler then threw, so every redelivery found
   the row already present and returned early: the timeline looked healthy while the rollup stayed
   empty. Fixed by sending `occurredAt.toISOString()::timestamptz`; reproduced and confirmed in a
   transaction that rolled back, then asserted by a new smoke check
   (`projection total_events=5 alerts=0 last_event_at=...`).
2. **Approval rules imported types the contract package does not export.** `ApprovalStatus` and
   `ApprovalAction` were imported from `@quorumloop/contracts`; they are derived from `Approval`
   locally now, and `APPROVAL_STATUSES` comes from the schema's own options instead of a second list.
3. **A notification was created for an action the audit service refuses to record.** Found during a
   JetStream replay: `destroy_everything` produced an inbox item that linked to no approval. The
   mapping now rejects any action outside `APPROVAL_ACTIONS`, with a regression test.
4. **The approval decision note would have been unreadable.** The endpoint accepts a note but
   `approvalSchema` had no such field, so a decided approval would have dropped it. Added as a
   nullable field (additive to the contract).

### Not verified, on purpose

- No notification delivery channel exists: preferences, e-mail and Telegram adapters are not
  implemented (see `KNOWN_LIMITATIONS.md`).
- Approvals never expire and there is no retention or export job behind `audit_retention_days`.
- The CI workflow still has not run on GitHub; the container images were not rebuilt in this cycle.

### Local state left behind

The ten core processes are running from `pnpm dev:core --compiled --no-web`. The smoke project is
deleted by the run; its activity rows remain, as the timeline is append-only by design.

## 2026-11-04: repository prepared for a first public push

Environment: Windows 11, Node 24.12.0, pnpm 10.20.0, PostgreSQL 16, NATS and Redis in Docker on
127.0.0.1:55432, 4222 and 6379.

### Gates

| Command               | Result                                                                |
| --------------------- | --------------------------------------------------------------------- |
| `pnpm build`          | 24 of 24 tasks successful                                             |
| `pnpm lint`           | 28 of 28 tasks successful                                             |
| `pnpm test`           | 28 of 28 tasks, 107 tests across 8 packages, no failures              |
| `pnpm test:contracts` | 4 of 4 tasks, 5 contract tests                                        |
| `pnpm format:check`   | all matched files use Prettier code style                             |
| `pnpm smoke`          | passed, 19 checks against a live 10-process cluster on 127.0.0.1:7001 |

This gate table is superseded by the entry above; it is kept as the record of what that cycle ran.

The smoke run's own output, in order: gateway probe 200, `setup/status needs_setup=false`, signed in
as `smoke@quorumloop.local`, session valid, anonymous call rejected with 401, mismatched CSRF token
rejected with 403, project created and listed, task created in backlog, board rendered, transitions
to ready / in_progress / in_review, `Done blocked as designed: quality gate has not run for this
task`, instruction recorded with `dispatch=not_configured`, activity feed showing
`instruction.received, task.created, task.transitioned, project.created`, overview KPIs, SSE ready
frame, project deleted.

### Defects found and fixed in this cycle

1. **Every event publish failed with `ERR_INVALID_ARG_TYPE`.** `appendOutbox` passed the envelope
   through `sql.json(envelope)`, and `drizzle(client)` had replaced the jsonb serialiser with an
   identity function, so the raw object reached the wire encoder. Bisected with throwaway probes: the
   plain postgres.js client serialises correctly, the same client fails the moment drizzle is
   attached. Fixed by writing `JSON.stringify(envelope)::jsonb`; regression test in
   `packages/platform/test/outbox.test.ts`. Verified end to end by a smoke run that creates a project
   and then reads the activity projection the outbox feeds.
2. **The CSRF smoke check was vacuous.** `send()` overwrote an explicitly supplied
   `x-csrf-token`, so the "mismatched token" request actually carried the valid one and the assertion
   passed for the wrong reason. Fixed by letting an explicit header win. The check now returns a real 403.
3. **`pnpm smoke` could only ever run once.** The first run created an admin with a random password
   that was never stored, so the second run died with "this instance is already set up". `pnpm setup`
   now generates `SMOKE_EMAIL` and `SMOKE_PASSWORD` into `.env`, and the script uses them.
4. **A bodyless internal call declared a JSON body.** `ServiceClient` always sent
   `content-type: application/json`, so `DELETE /api/v1/projects/:id` failed with
   `VALIDATION_FAILED: Body cannot be empty when content-type is set to 'application/json'`. Fastify
   rejects the payload before routing. The header is now only sent with a body; regression test in
   `packages/platform/test/service-client.test.ts`.
5. **The smoke script asserted a transition the domain forbids.** It jumped `backlog` straight to
   `in_progress`, which the board rejects by design (the only path is
   `backlog -> ready -> in_progress -> in_review -> done`). The script now walks the legal path, which
   also makes the quality-gate check meaningful: `Done` is attempted from `in_review`, the only legal
   predecessor.

### Documents written or corrected

- New: `LICENSE`, `NOTICE`, `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `DECISIONS.md`, `KNOWN_LIMITATIONS.md`, `.github/workflows/ci.yml`, `.github/dependabot.yml`,
  `.github/ISSUE_TEMPLATE/*`, `.github/pull_request_template.md`, this file.
- `IMPLEMENTATION_PLAN.md` was rewritten. It previously marked the dashboard, Phase 2, Phase 3, the
  CI workflow and the README/LICENSE as done. None of that was true: `apps/web` does not exist, all
  six Phase 2 services and all four Phase 3 services are boot-only scaffolds, and the repository had
  no `README`, `LICENSE` or workflow. Statuses now match the source tree.

### Not verified, on purpose

- The GitHub Actions workflow has never run. It is written against Node 24.12.0 and pnpm 10.20.0 and
  mirrors the local gate names, but "the YAML parses" is not "the pipeline is green".
- No container image was built in this cycle. The Dockerfiles and Compose files were not exercised;
  only the local Node path was.
- `pnpm compose:core` cannot succeed until `apps/web` exists (see `KNOWN_LIMITATIONS.md`).
- Five smoke projects from earlier failed runs remain in the development database. They are test
  rows in a throwaway database; nothing in the repository depends on them.

### Local state left behind

The ten core processes were started with `pnpm dev:core --compiled --no-web` and are still running on
ports 7001-7020. `.env` carries generated secrets plus the smoke credentials. The PostgreSQL volume
holds the smoke workspace, its user and the projects listed above.

## Earlier

Phase 0 (foundation) and the Phase 1 vertical slice up to `activity-service` were built before this
entry: workspace, shared packages, twenty service packages, identity, gateway, project, task,
source-control, webhook and activity services, plus the Compose and migration tooling. `PROGRESS.md`
was created at the end of that work, so this file starts with the state as it stands rather than
reconstructing intermediate steps that cannot be re-verified.
