# Decision log

Architectural decisions live in [`docs/adr/`](docs/adr). This file is the short index plus the
operational decisions that do not deserve a full ADR: they are reversible, they are local to one
file, or they record why something was deliberately left out.

The format is one entry per decision: context, decision, consequence. Entries are append-only; if a
decision is reversed, add a new entry that supersedes it and say so.

## ADR index

| ADR                                                  | Decision                                             | Status                        |
| ---------------------------------------------------- | ---------------------------------------------------- | ----------------------------- |
| [001](docs/adr/ADR-001-monorepo.md)                  | Single monorepo, pnpm workspaces, Turborepo          | accepted                      |
| [002](docs/adr/ADR-002-service-boundaries.md)        | Twenty domain boundaries                             | accepted                      |
| [003](docs/adr/ADR-003-node-nest-fastify.md)         | Node.js 26 LTS, NestJS, Fastify                      | accepted, deviated (see D-01) |
| [004](docs/adr/ADR-004-nats-jetstream-outbox.md)     | NATS JetStream with a transactional outbox           | accepted                      |
| [005](docs/adr/ADR-005-postgres-ownership.md)        | One PostgreSQL database and role per service         | accepted                      |
| [006](docs/adr/ADR-006-runner-isolation.md)          | Runner isolation for agent processes                 | accepted, not implemented     |
| [007](docs/adr/ADR-007-paseo-orca-adapters.md)       | Paseo primary runtime, Orca opt-in adapter           | accepted, not implemented     |
| [008](docs/adr/ADR-008-fallback-checkpoints.md)      | Provider fallback with fenced leases and checkpoints | accepted, not implemented     |
| [009](docs/adr/ADR-009-license-strategy.md)          | Apache-2.0 with attribution for vendored material    | accepted                      |
| [010](docs/adr/ADR-010-web-ux-antislop.md)           | Web experience direction and Anti-Slop               | accepted, not implemented     |
| [011](docs/adr/ADR-011-nestjs-clean-architecture.md) | Feature modules, selective CQRS                      | accepted                      |

## Operational decisions

### D-01. Development and CI run Node 24.12.0, container images run Node 26

ADR-003 targets Node 26 LTS. The machine this repository was built on has Node 24.12.0, and every
gate (build, lint, typecheck, 137 tests) passes there. `engines` is `>=24`, so both satisfy the
declaration, and the Dockerfiles pin `node:26-alpine`.

Consequence: CI and the container runtime are not the same version. Moving CI to 26 is a one-line
change once the toolchain is verified there; the reverse (pinning containers to 24) would contradict
the ADR. Recorded rather than hidden.

### D-02. The outbox writes `JSON.stringify(envelope)::jsonb`, never `sql.json`

`drizzle(client)` patches the postgres.js client: it replaces the json and jsonb serialisers with an
identity function because its own columns stringify JSON. After that patch `sql.json(object)` passes
a raw object to the wire encoder and the insert fails with `ERR_INVALID_ARG_TYPE`. The failure is
silent until the first event is published, which is why it reached a live run.

Consequence: all jsonb writes go through an explicit stringify and cast. The regression test in
`packages/platform/test/outbox.test.ts` asserts the parameter is a string and the statement contains
`::jsonb`, and its fake client has no `json` helper, so a reintroduced `sql.json(...)` cannot pass.
Not fixed by patching node_modules: the interaction is a documented drizzle behaviour, not a bug to
shim.

### D-03. Contracts are owned by `packages/contracts` and change with their tests

Every request, response and event shape is a zod schema in `packages/contracts`. Services and the
gateway validate with `parseWith`, and `pnpm test:contracts` guards the schemas.

Consequence: a breaking contract change is visible in one diff and one failing test run, instead of
being discovered by a consumer at runtime. Hand-written TypeScript interfaces for wire payloads are
rejected in review.

### D-04. Only `main` is supported, and the repository ships no release process yet

There is no versioning scheme, no changelog automation and no published artefact. `package.json`
carries `0.1.0` and the licence, nothing more.

Consequence: tags are not created until there is something installable. The `v*` tag ruleset is
created in advance so the first tag cannot be moved or deleted casually.

### D-05. The CI dependency job is advisory; Dependabot is the enforcement path

`pnpm audit` fails on transitive advisories that are not actionable in this repository, and a red
pipeline on an upstream CVE trains people to ignore the pipeline. The job runs with
`continue-on-error` and prints an inventory of production licences; Dependabot alerts and security
updates are where a vulnerability is actually worked.

Consequence: a dependency advisory can merge without an immediate fix. The mitigation is that the
alert exists and is assigned, not that the build blocks.

### D-06. `apps/web` is not in this snapshot, so the Compose core profile is incomplete

The dashboard is a 3-month-sized piece of work on its own (ADR-010). Shipping it half-built would
mean shipping fabricated data in the product whose whole premise is that it does not fabricate.
`infrastructure/compose` keeps the service definition so the profile is complete, and
`pnpm compose:core` fails loudly instead of starting a stack with a missing container.

Consequence: the only way to use Quorumloop today is the HTTP API. This is stated in the README,
`KNOWN_LIMITATIONS.md` and the issue templates rather than left for a newcomer to discover.

### D-07. Scaffolded services stay in the tree and boot cleanly

Ten services have no domain code. Deleting them would lose the port allocation, health contract and
Compose wiring; leaving them broken would make `pnpm dev:core` unusable.

Consequence: each scaffold builds, boots, answers `/health/ready` and rejects unsigned `/internal/*`
calls with a 401. The overview projection reports them as unavailable, and the docs list them as
scaffolds. The failure mode is "endpoint missing", not "endpoint returns fake success".

### D-08. Verdicts are recorded with evidence, not with percentages

`PROGRESS.md` records what was run and what it printed, including the commands that were not run.
A status line without a command behind it is treated as a claim, and claims are cheap.

Consequence: the documents occasionally read as cautious. That is the intended trade: a reader can
re-run any line and get the same output.

### D-09. An approval is materialized from its event, keyed by the producer's id, and a decision is final

The audit service does not own the workflow that requests an approval. It subscribes to
`approval.required.v1`, validates the payload against the contract, and inserts the approval with the
id the producer chose. The insert uses `on conflict do nothing`, so a replay cannot create a second
queue entry, and the decision update carries `status = 'pending'` in its `WHERE`, so two admins
clicking at the same time cannot both win.

Consequence: approvals can be replayed from the event stream to rebuild the queue, and a decision
returns `409` instead of silently overwriting the first one. Two limits follow from this: the queue
only exists for services that publish the event (nothing else can enqueue an approval), and
`requested_by` records the producing _service_, because the payload names an action rather than a
person. Approvals also never expire on their own; a `pending` row stays pending until somebody
decides it.

### D-10. The notification inbox is a per-member projection of events, in-app only

Notifications are derived from `approval.required.v1` and `review.created.v1`. `notification_reads`
is one row per `(notification, member)`, so read state is personal and a second member still sees an
unread item. The feed is bounded at 100 rows; the unread count is a `count(*)` rather than a capped
number.

Consequence: the inbox can be rebuilt from the event stream, and no delivery channel is involved.
Per-notification preferences, e-mail and Telegram adapters are deliberately absent: sending mail from
a service whose outbox is not verified yet would be a claim the code cannot support. The mapping also
rejects any event it cannot render faithfully (unknown approval action, envelope and payload naming
different organizations), so the inbox never links to a record another service refused to create.

### D-11. Timestamps cross the raw driver boundary as ISO strings with an explicit cast

`ActivityRepository.append` wrote a `Date` into a raw postgres.js parameter for a `timestamptz`
column. postgres 4.0.0 fails to encode it when the server infers the parameter type from the insert
target (`ERR_INVALID_ARG_TYPE` from `Buffer.byteLength`), while the same value works in a `select`
and through drizzle's own insert path. The statement now sends `occurredAt.toISOString()` with
`::timestamptz`.

Consequence: every hand-written statement passes timestamps as text, which server-side parsing
already handles for every column type. Drizzle-owned writes keep using `Date` values, so the cast
stays confined to the one raw statement that writes a timestamp. A smoke assertion on the project
rollup keeps the failure from returning silently, because the thrown handler error left the timeline
readable while the rollup stayed empty.

### D-12. Settings publishes no policy event until a consumer exists

A policy write is a transactional state change like any other, so the obvious next step is an outbox
row and a `settings.policy.updated.v1` event. The only consumer would be provider-router, which is
still a scaffold: the event would have no reader, no test and no way to be proven correct.

Consequence: `settings-service` writes the policy and its revision and publishes nothing. When
provider-router or the dashboard needs the event, it is added together with its consumer and its
contract test, not before. The service catalog lists this explicitly so the missing publish is not
read as an omission.

### D-13. Repository settings are files applied by a script, and only three checks block a merge

GitHub reads none of the About metadata, merge options or branch protection from the tree. Leaving
them as clicks means the repository configuration exists only in a browser session. The desired
state lives in `.github/repo-settings.json` and `.github/rulesets/main.json`, and `pnpm github:setup`
applies it through the REST API, so changing a rule is a reviewable diff.

Consequence: `lint`, `types` and `test` are the required status checks. The `dependencies` job stays
advisory (`continue-on-error`), because an upstream advisory must be triaged rather than blocking
every pull request, and Dependabot is the enforcement path. The ruleset requires a pull request but
zero approvals: a repository with one maintainer that demands an approval from somebody else cannot
merge at all. Raising the count is a one-line change in the JSON when a second maintainer exists. A
token with Administration write is needed to apply the file; there is no file GitHub reads on its own.

### D-14. Repository admins bypass the default-branch ruleset

The owner asked to keep pushing to `main` directly while the ruleset stays strict for everyone else.
`.github/rulesets/main.json` lists the repository `admin` role (`actor_id` 5, `RepositoryRole`) in
`bypass_actors` with `bypass_mode: always`. On a personal repository only the owner holds that role,
so contributors still need a pull request and the `lint`, `types` and `test` checks.

Consequence: a direct push from the owner skips CI, so `pnpm check` before pushing is the owner's
gate. Anyone later granted the admin role inherits the bypass; switch `bypass_mode` to
`pull_request` or remove the entry when a second maintainer joins.

### D-15. The dashboard is a same-origin SPA that imports contract types only

`apps/web` is React 19 + Vite 8 + TanStack Router and Query, as PRD section 5 fixes. Three choices
shape it:

- **One origin.** In development Vite proxies `/api` to the gateway; in Compose the gateway serves
  the build from `WEB_DIST_DIR` (`services/api-gateway/src/static-web.ts`). The session cookie and
  the double-submit CSRF header therefore work without CORS, and the SSE relay, which writes to the
  raw socket and skips the CORS plugin, works too. The static handler never answers `/api` or
  `/health`, so an unknown API route still gets the gateway's error envelope.
- **Contract types, not contract code.** The client uses `import type` from
  `@quorumloop/contracts`, so the browser bundle carries no zod and the gateway stays the only
  validator. A contract change still breaks `pnpm typecheck` for the web app.
- **Honest figures over the overview payload.** `/api/v1/overview` folds a failed dependency into
  `0`. Rather than change the gateway contract in the same step, the dashboard shows a figure only
  when the owning service answered `/api/v1/health`, and shows the quality and agent figures as
  Unavailable because their services are scaffolds (`apps/web/src/lib/domain.ts`). Fixing the
  payload to carry `null` for an unavailable figure is the cleaner end state.

Consequence: the board offers moves from a client copy of the transition table, guarded by a test
that reads `task.rules.ts`; the server remains the authority and its refusal reason is shown.

### D-16. Dockerfiles install pnpm with npm instead of corepack

`node:26-alpine` ships without `corepack` (Node 25 removed it from the distribution), so the
original `corepack enable` line failed with exit 127 and no image could build. Every Dockerfile now
runs `npm install -g pnpm@10.20.0`, which pins the same version as `packageManager`. A root
`.dockerignore` keeps `node_modules`, build output and `.env` out of the build context.

### D-17. The gateway does not resolve services the deployment does not run

In the Compose core profile ten of the twenty services exist. `GET /api/v1/health` probed all of
them, and resolving an absent container name through Docker's DNS took 2 to 4 seconds before
`ENOTFOUND`. Node resolves names on libuv's thread pool (four threads by default), so ten slow
lookups stalled every other upstream call: the dashboard, which polls health, made the gateway
answer `503 UPSTREAM_UNAVAILABLE` (`UND_ERR_CONNECT_TIMEOUT`) for sign-in and every list in bursts.

Two changes, both measured against the live Compose stack:

- `QUORUMLOOP_DEPLOYED_SERVICES` lists the services a profile runs. The gateway reports any other
  catalogued service as `unknown` with the detail `not deployed in this profile`, and the overview
  skips it, without a DNS lookup. Unset or `all` keeps the old behaviour; `pnpm compose:full` loads
  `infrastructure/compose/full.env` to set `all`.
- `UV_THREADPOOL_SIZE=32` on the gateway, so a slow lookup cannot starve the rest.

Result: `/api/v1/health` went from 2.0 s to under 50 ms, and the dashboard click-through against the
Compose stack went from 29 upstream failures to 0. `ServiceClient` now puts undici's `cause` into the
error message (`fetch failed (UND_ERR_CONNECT_TIMEOUT: ...)`), which is what made this diagnosable.

### D-18. The project page is a separate static site, not a screen of the dashboard

The owner asked for a landing page. The PRD (section 12) and `DESIGN.md` sections 1 and 10 say the
dashboard is not a landing page and must not carry a marketing hero, so the page lives in
`apps/site`: a static HTML page with a few lines of TypeScript, built by Vite with a relative base
so it can be served from any path (GitHub Pages included) without a rebuild. The dashboard is
unchanged and a self-hosted instance never shows marketing copy to its own operators.

The page reuses the dashboard's tokens, type and round-rule motif so the two read as one product,
and `tokens.test.ts` fails if its colours drift from `apps/web/src/styles.css`. Its only images are
real screenshots from the dashboard click-through, captioned as such. Every status claim on it is
copied from README's status table and `KNOWN_LIMITATIONS.md`. It is not published anywhere:
publishing needs the owner's approval (AGENTS.md rule 8).
