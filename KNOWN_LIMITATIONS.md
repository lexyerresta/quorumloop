# Known limitations

Everything below is verified against the current source tree. Each entry states what is missing,
what it affects, and what to do instead. If you find a gap that is not listed here, it is a
documentation bug worth reporting.

## Product surface

- **The dashboard does not exist.** `apps/web` is absent: no React/Vite app, no route shell, no
  query layer, no Anti-Slop-composed screens. Every interaction must go through the HTTP API.
  `pnpm compose:core` therefore cannot build, because the Compose file expects that image.
- **No AI agent is ever executed.** `execution-service` is a scaffold. It does not read
  `EXECUTION_ENABLED`, does not probe CLIs, and does not call Paseo, Orca or any provider adapter.
  The settings for those integrations exist in `packages/config` and `.env.example` as placeholders.
  Nothing in the product fabricates agent runs, commits, pull requests or usage numbers, because
  nothing in the product runs agents yet.
- **10 of 20 services are boot-only scaffolds** — workspace, agent-control, provider-registry,
  provider-router, orchestration, execution, product-planning, scheduler, quality, usage. Each one
  starts, serves `/health/ready`, and enforces the internal-call guard on `/internal/*`, but owns no
  schema and exposes no domain endpoint. Gateway routes that depend on them (`/api/v1/usage`, the
  runtime and planning routes) return an upstream error rather than invented data; the overview
  projection marks them unavailable.
- **Demo mode is a flag, not a feature.** `DEMO_MODE` is validated, surfaced in the session and
  overview payloads, and stored on the organization policy, but there is no seeding path, so no demo
  dataset exists to mislabel.
- **Notifications are in-app only.** The inbox is an event projection with per-member read state.
  Only `approval.required.v1` and `review.created.v1` are projected; `execution.failed`,
  `quality.completed` and `provider.limited` are not rendered yet. There are no per-notification
  preferences, no e-mail or Telegram adapter, no digest, and no delivery retry, because no outbound
  channel is wired at all. The feed returns at most 100 rows, newest first; the unread count is
  exact.
- **Approvals do not expire, and there is no audit retention.** A `pending` approval stays pending
  until an `owner` or `admin` decides it, a decision is final, and nothing re-opens a rejected one.
  `audit_retention_days` is stored on the policy but no job enforces it, and there is no export of
  the approval queue.
- **Policy is organization-wide and not enforced.** `settings_policies` has one row per organization
  with an append-only revision history. Per-project policy, per-role overrides, feature flags and
  applying the stored `autonomy_level`/`quality_gate_required` values in another service are not
  implemented: the policy is currently read and written, not enforced, and `settings-service`
  publishes no event yet (`DECISIONS.md` D-12).

## Identity

- Invitations have a table and repository but no delivery and no accept flow, so adding a member is
  the only way to grant access.
- No password reset, no email verification, no MFA, no OAuth/OIDC login, no session listing or
  remote revocation.
- A session is bound to one organization. Multi-organization users are not supported yet.

## Security and abuse

- **No rate limiting or lockout** on `POST /api/v1/auth/login` or anywhere else in the gateway.
  Exposing an instance to the internet requires a proxy that rate limits.
- Password reset tokens, email links and other out-of-band flows do not exist, so there is nothing
  to expire.
- Audit logging covers approvals, not requests. `audit-service` owns the approval queue and its
  decisions; gateway requests, membership changes and policy writes are not recorded in a general
  audit trail. Service logs are structured but local to each process.
- The HMAC internal signature protects service-to-service calls from outside callers, not from a
  compromised service inside the network. There is no per-caller authorisation beyond the signature.
- Webhook delivery is not retried from the inbox if a downstream handler fails; the delivery is
  recorded and the failure is visible, but there is no scheduler-driven replay.

## Operations

- **No Kubernetes manifests.** `infrastructure/` contains Postgres init scripts, NATS config and
  Compose files. The architecture is container-per-service, but there is no Helm chart, Kustomize
  overlay or manifest set.
- **No backup, restore or upgrade tooling.** Migrations run on boot when `AUTO_MIGRATE=true`, or via
  `pnpm db:migrate`; there is no rollback story beyond expand-contract discipline.
- **No leader election.** Any future periodic work assumes a single replica per service. The
  activity SSE hub is per process, so with more than one replica a client only receives events for
  its own process and must rely on the cursor catch-up on reconnect.
- Credential rotation for `POSTGRES_SERVICE_PASSWORD` requires `ALTER ROLE` or a fresh volume,
  because the init script only runs on first initialisation.
- The CI dependency job is advisory. Known-vulnerability enforcement lives in Dependabot alerts, not
  in the pipeline.

## Toolchain and platform

- The Dockerfiles pin `node:26-alpine` while development and CI run Node 24.12.0 (`engines` says
  `>=24`). Both work, but the container and the dev machine are not the same runtime.
- `pnpm dev` starts every service through one Turbo run. Without `--compiled` that means 20 `tsx
watch` processes; on a 16 GB machine this swaps. Use `pnpm dev:core --compiled` and
  `--only <services>` instead.
- The supported development path is Windows, Linux and macOS with Docker Desktop. Rootless Docker
  and remote Docker hosts are untested.

## Implementation quirks worth knowing

- **`sql.json()` is unusable on a drizzle-wrapped postgres.js client.** Drizzle replaces the json
  and jsonb serialisers with identity functions, so `sql.json(object)` hands a raw object to the
  wire encoder and fails with `ERR_INVALID_ARG_TYPE`. The outbox writes
  `JSON.stringify(envelope)::jsonb` instead, and `packages/platform/test/outbox.test.ts` guards the
  behaviour. Any new code writing jsonb has to do the same.
- **A raw `Date` parameter fails when the server infers its type from the insert target.** With
  postgres 4.0.0, `values (..., ${new Date()}, ...)` against a `timestamptz` column throws
  `ERR_INVALID_ARG_TYPE` inside the driver, while the same value works in a `select` or through
  drizzle's insert path. Hand-written statements send `value.toISOString()` with `::timestamptz`
  (`DECISIONS.md` D-11). This one is easy to miss: the row is inserted, the handler throws afterwards,
  and a redelivery then finds the row and returns quietly.
- **A bodyless internal call must not declare `content-type: application/json`.** Fastify rejects an
  empty payload that claims to be json with a 400 before routing, which surfaced as a failing
  `DELETE /api/v1/projects/:id`. `ServiceClient` now only sets the header when it sends a body, and
  `packages/platform/test/service-client.test.ts` guards it.
- **Action endpoints answer `201 Created`.** `POST /api/v1/tasks/:id/transition`, and the other
  `POST` actions that mutate an existing resource, do not opt into `200`, so Nest keeps its default.
  The body is correct and `pnpm smoke` accepts any 2xx, but a client that branches on the status
  code has to treat 201 as success rather than "row created".
- Scaffolded services ship a `/health/ready` that reports `ready` once the process is listening.
  Readiness does not check dependencies, because none are wired yet.
- The webhook service assumes it can be reached from the forge. Tunnelling is the operator's job; no
  relay or polling fallback is implemented.
