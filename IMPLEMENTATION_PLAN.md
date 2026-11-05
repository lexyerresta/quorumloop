# Quorumloop implementation plan

Source of truth for scope is `PRD_QUORUMLOOP.md`. This file tracks the order of work, the
dependencies between phases and the current status. Status values: `done`, `partial`, `scaffold`,
`todo`, `blocked`.

`done` means implemented and covered by a command you can re-run. `partial` means the main path works
and named pieces do not. `scaffold` means the package exists and boots, with no domain code.

Last updated: 2026-11-05.

## Phase 0: foundation

| Item                                                                       | Status | Evidence                                                                                         |
| -------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| Anti-Slop installed (`docs/antislop/antislop.md`) and `DESIGN.md` authored | done   | `DESIGN.md`, `AGENTS.md` antislop block                                                          |
| ADR-001..011                                                               | done   | `docs/adr/`, indexed in `DECISIONS.md`                                                           |
| Service catalog and dependency graph                                       | done   | `docs/architecture/service-catalog.md`, `packages/config/src/index.ts`                           |
| pnpm + Turborepo workspace, TS baseline, ESLint, Prettier                  | done   | `pnpm lint` 28/28, `pnpm format:check` clean                                                     |
| Shared packages: `contracts`, `config`, `observability`, `platform`        | done   | `pnpm build` 24/24                                                                               |
| 20 service packages with build, health and Dockerfile                      | done   | `services/*`, `pnpm build` 24/24                                                                 |
| Compose core/full/demo, Postgres ownership init, NATS config               | done   | `pnpm compose:core` builds and runs 10 services plus the dashboard on 8080; full profile not run |
| Setup script, `.env` generation, secrets                                   | done   | `scripts/setup.mjs`, `pnpm setup`, smoke credentials generated                                   |

Phase 0 exit criterion was "every service builds, boots and answers `/health/ready`; the dashboard
renders a real empty state against a live gateway". Both halves hold: the services answer on ports
7001-7020, and the dashboard renders its empty states against the live gateway in development and
behind the Compose gateway (`docs/quality/clickthrough-log*.md`). Phase 0 is closed.

## Phase 1: usable product (vertical slice)

Order: identity → gateway → project → source-control → webhook → task → activity →
settings/notification/audit → dashboard.

| Item                                                                                         | Status  | Evidence / Notes                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity: login, logout, session cookie, `/me`, setup wizard, member RBAC, password change   | partial | 7 tests; no invitations flow, password reset or MFA                                                                                                                                            |
| Gateway: session guard, CSRF double submit, signed internal calls, route catalogue, SSE      | done    | 9 controllers, smoke run green (20 checks)                                                                                                                                                     |
| Project: CRUD, repo binding, onboarding state machine                                        | done    | 9 tests                                                                                                                                                                                        |
| Source control: GitHub (PAT and App) and GitLab adapters, repo sync, commit cache, PR create | done    | 11 tests, token sealed with AES-256-GCM                                                                                                                                                        |
| Webhook: signature verification (GitHub HMAC, GitLab token), delivery dedup, normalization   | done    | 12 tests, raw body required                                                                                                                                                                    |
| Task: epics, tasks, Kanban lanes, DAG dependencies, transition rules, history                | done    | 27 tests                                                                                                                                                                                       |
| Activity: feed projection from events with SSE cursor                                        | done    | 23 tests; project rollup asserted by smoke                                                                                                                                                     |
| Settings: org and project policy, revisions, demo flag                                       | done    | 12 tests, `settings_policies` + revision history, `GET/PUT /api/v1/settings/policies`; org scope only, no per-project policy                                                                   |
| Notification: in-app notifications, read state                                               | done    | 8 tests, inbox from `approval.required` and `review.created`, per-member read state, `GET /api/v1/notifications`, `POST /api/v1/notifications/:id/read`, `POST /api/v1/notifications/read-all` |
| Audit: administrative trail and approvals                                                    | done    | 10 tests, approval queue materialized from `approval.required`, `GET /api/v1/approvals`, `POST /api/v1/approvals/:id/decision`; no general trail beyond approvals                              |
| Dashboard: overview, projects, onboarding, Kanban, task composer, activity, settings         | done    | `apps/web`; click-through 3/3 on dev and Compose, axe 0 violations, 46 unit tests; Anti-Slop gate PASS (`docs/quality/anti-slop-gate.md`); runtime screens wait for Phase 2                    |

Phase 1 is closed for the implemented services: the dashboard covers every Phase 1 API, and each
screen was clicked through against a live gateway. Identity stays `partial` (no invitations, reset
or MFA), and a task cannot reach Done until Phase 3 runs quality gates (`KNOWN_LIMITATIONS.md`).

## Phase 2: agent runtime

Nothing in this phase is implemented. All six services are boot-only scaffolds.

| Item                                                                             | Status   | Notes                                     |
| -------------------------------------------------------------------------------- | -------- | ----------------------------------------- |
| Workspace: worktree create/remove, path guard, artifacts                         | scaffold | no schema, no endpoints                   |
| Provider registry: CLI capability probes for claude, codex, opencode, qoder      | scaffold | probing does not exist                    |
| Provider router: priority, cooldown, circuit breaker, decision trace             | scaffold | no routing table, no cooldown state       |
| Orchestration: fenced leases, workflow runs, checkpoints, recovery               | scaffold | ADR-008 describes behaviour not yet built |
| Execution: Paseo adapter, CLI adapters, transcript stream, instruction injection | scaffold | `EXECUTION_ENABLED` is read by nothing    |
| Agent control: sessions, presence, timeline                                      | scaffold | no schema, no endpoints                   |

## Phase 3: autonomy

Also entirely scaffold: scheduler, quality, product-planning and usage-service boot and serve health
only. No tick loop, no quality gate evaluation, no idea intake, no usage accounting.

## Phase 4: adapters

| Item                               | Status | Notes                                                        |
| ---------------------------------- | ------ | ------------------------------------------------------------ |
| Orca adapter behind `ORCA_ENABLED` | todo   | no code; the flag is declared in config and nothing reads it |
| Qoder CLI adapter                  | todo   | no code                                                      |
| Kubernetes manifests               | todo   | Compose is the supported path; no Helm chart or manifests    |

## Cross-cutting

| Item                                                                           | Status  | Evidence                                                                                                           |
| ------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------ |
| Contract tests for events and API DTOs                                         | done    | `pnpm test:contracts` 5/5 in `packages/contracts/test`                                                             |
| Unit tests for domain rules (task transitions, routing, path guard, signature) | done    | 137 tests across 11 packages, `pnpm test` 28/28                                                                    |
| Live smoke script (`pnpm smoke`)                                               | done    | 20 checks green against a live 10-process cluster                                                                  |
| Dashboard click-through with axe (`pnpm --filter @quorumloop/web e2e`)         | done    | 3 tests, needs a live stack; not part of CI yet                                                                    |
| Project page `apps/site` (static, not published)                               | done    | `pnpm --filter @quorumloop/site e2e` 2/2, axe 0 violations, 3 unit tests; gate in `docs/quality/anti-slop-gate.md` |
| CI workflow                                                                    | partial | `.github/workflows/ci.yml` written; not yet exercised on GitHub                                                    |
| Dependabot, issue templates, PR template                                       | done    | `.github/`                                                                                                         |
| Open-source docs: README, CONTRIBUTING, SECURITY, NOTICE, LICENSE, CoC         | done    | repository root                                                                                                    |
| Status docs: PROGRESS, DECISIONS, KNOWN_LIMITATIONS                            | done    | repository root                                                                                                    |

## Next work, in order

1. **Overview payload honesty**: carry `null` instead of `0` for an unavailable figure in
   `/api/v1/overview`, so the dashboard no longer infers availability from `/api/v1/health`
   (`DECISIONS.md` D-15).
2. **Identity completion**: invitations (send and accept), password reset, session listing.
3. **Rate limiting and lockout** on the gateway, so an exposed instance is not trivially brute
   forced.
4. **Workspace and agent-control**: worktree lifecycle with a path guard, then sessions and
   presence, which the dashboard needs for a live view.
5. **Provider registry and router**: capability probes with honest "not installed" reporting, then
   routing with cooldown and circuit breaking. Expose acceptance-criterion verification through
   the gateway so Done becomes reachable once quality runs exist.
6. **Orchestration and execution**: fenced leases and checkpoints, then one real adapter end to end.
   This is the first point at which Quorumloop runs an agent.
7. **Quality gate and scheduler**: the loop that turns Task Done into verified work.
8. **Kubernetes manifests** and backup/restore tooling.
