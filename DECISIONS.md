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
