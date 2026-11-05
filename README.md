# Quorumloop

Self-hosted AI development orchestration platform. Quorumloop turns a project backlog into
delegated work that AI coding agents execute, review and report back — with real repositories,
real branches, real pull requests and a durable audit trail.

It is a TypeScript monorepo of independently deployable services (NestJS + Fastify), a PostgreSQL
database per service, NATS JetStream for events, and a Docker Compose self-hosting path.

> Quorumloop is an independent project. It is not affiliated with Anthropic, OpenAI, OpenCode,
> Qoder, Paseo, Orca, GitHub or GitLab. See [NOTICE](NOTICE).

## Status

Development is in progress and this section describes what the code actually does today, not what
is planned. Anything not listed as working is not implemented.

| Area                                                                                   | State                                                                    |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Monorepo, shared packages, strict TypeScript, lint/format gates                        | working                                                                  |
| PostgreSQL ownership per service, SQL migrations, outbox + inbox                       | working                                                                  |
| Identity: first-run admin setup, login, session cookie, CSRF, RBAC                     | working                                                                  |
| API gateway: public REST surface, signed internal calls, SSE relay                     | working                                                                  |
| Projects: CRUD, import, from-idea drafts, repository binding                           | working                                                                  |
| Source control: GitHub (PAT and App) and GitLab adapters, commit/branch/PR cache       | working                                                                  |
| Webhooks: GitHub HMAC and GitLab token verification, delivery dedupe                   | working                                                                  |
| Tasks: epics, Kanban lanes, DAG dependencies, transition rules, quality gate on Done   | working                                                                  |
| Activity: event-fed timeline, cursor pagination, server-sent events                    | working                                                                  |
| Settings: organization policy and revision history, read by every policy decision      | working                                                                  |
| Audit: approval queue fed by events, admin decisions, decision note and actor          | working                                                                  |
| Notification: in-app inbox fed by events, per-member read state, unread count          | working                                                                  |
| Dashboard (`apps/web`): sign-in, setup, overview, projects, Kanban, composer, activity | working against the implemented services; runtime screens are absent     |
| Runtime and planning services (orchestration, execution, scheduling, usage, quality)   | boot-only scaffolds: they start, answer health probes, and own no schema |

Consequences worth knowing before you deploy:

- 10 of the 20 services are implemented. The other 10 build, boot and serve `/health/ready`, but
  every domain endpoint is missing.
- Gateway routes that depend on a scaffolded service (`/api/v1/usage`, the runtime and planning
  routes) return an upstream error instead of data. The overview endpoint still answers, but it reports an
  unreachable dependency as 0; the dashboard shows those figures as Unavailable instead.
- No AI agent runs are executed by this snapshot. `execution-service` is a scaffold that reads
  nothing, so `EXECUTION_ENABLED`, `PASEO_DAEMON_URL` and `ORCA_ENABLED` are placeholders with no
  code behind them. Quorumloop never fabricates agent activity, commits or usage numbers, because no
  agent path exists yet.

The full work order, with per-item evidence and status, lives in
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). Open gaps are listed in
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## Architecture

```
browser
   |
   v
api-gateway (7001)  --- session cookie + CSRF, signed internal calls
   |  |  |  |  |
   |  |  |  |  +--> activity-service (7018) --SSE--> browser
   |  |  |  +-----> task-service (7016) ------+
   |  |  +--------> source-control-service (7006) ---> GitHub / GitLab HTTP APIs
   |  |  |                                    |
   |  |  |                                    +--> webhook-service (7007) <--- forge webhooks
   |  |  +--------> project-service (7003) ---+
   |  +-----------> identity-service (7002)
   +--------------> settings (7004), notification (7005), audit (7020)

every data-owning service -> own PostgreSQL database -> outbox -> NATS JetStream -> consumers
```

Rules that the code enforces rather than documents:

- One database and one login role per service; no service reads another service's tables.
- Cross-service reads happen over signed internal HTTP; cross-service reactions happen over NATS.
- Events are written to a transactional outbox in the same transaction as the state change, then
  published. A consumer deduplicates by event id, so a redelivery cannot double-apply.
- The gateway holds no business rules: it authenticates the browser session, then forwards.

Details: [docs/architecture/service-catalog.md](docs/architecture/service-catalog.md) and the
decision records in [docs/adr/](docs/adr/).

## Requirements

- Node.js **24 or newer** (CI runs 24; the PRD targets the Node 26 LTS line, see
  [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md))
- pnpm **10.20.0** (`npm install -g pnpm@10.20.0`; Node 25 and later no longer ship `corepack`)
- Docker with Compose v2, for PostgreSQL, Redis and NATS

## Getting started

There are two ways to run Quorumloop. Both start from a clone and a generated `.env`:

```bash
git clone https://github.com/lexyerresta/quorumloop.git
cd quorumloop
npm install -g pnpm@10.20.0
pnpm install
pnpm run setup        # writes .env with generated secrets; add --force to rotate them
```

Type `pnpm run setup`, not `pnpm setup`: the second form is pnpm's own command that configures
`PNPM_HOME`, and it never reaches the project script.

### Option A: everything in Docker (to use the app)

```bash
pnpm compose:core
```

This builds the gateway, the nine implemented services and the dashboard into containers, starts
PostgreSQL, Redis and NATS, and applies the migrations on boot (`AUTO_MIGRATE=true` in `.env`).
The first build takes several minutes. When every container reports healthy, open
**http://localhost:8080**.

Keep the terminal open, or add `-d` to run it in the background
(`docker compose --env-file .env -f infrastructure/compose/compose.core.yml --profile core up -d --build`).
Stop it with `Ctrl+C`, or with `docker compose --env-file .env -f infrastructure/compose/compose.core.yml --profile core down`.
Your data stays in the `pgdata` volume between runs. After a reboot, start Docker Desktop first.

### Option B: services on the host (to change the code)

```bash
pnpm infra:up         # starts postgres, redis and nats, waits for health
pnpm build            # compiles packages and services
pnpm db:migrate       # applies each service's SQL migrations
pnpm dev:core --compiled
```

Open **http://localhost:5173** for the dashboard; the API answers on http://127.0.0.1:7001.

`pnpm dev:core` starts ten processes: the gateway and the nine implemented services. Orchestration
and execution stay out of the core profile so nothing can spend provider quota by accident. Two
flags matter on a small machine: `--compiled` runs the build output instead of one `tsx watch`
process per service, and `--no-web` skips the dashboard dev server. Use
`--only identity-service,task-service` for a smaller set, and drop `--compiled` when you want hot
reload.

Do not run both options at once: they publish the same PostgreSQL, Redis and NATS ports.

### Check that it works

```bash
pnpm smoke
```

`pnpm smoke` runs 20 checks against a live gateway: it signs in (or creates the first admin), checks
the session, rejects an anonymous call and a mismatched CSRF token, creates a project, creates a
task, walks it through the legal transitions, asserts that the quality gate answers honestly,
records an instruction, waits for the activity rows and the project rollup behind them, and reads
the SSE stream, then deletes what it created unless you pass `--keep`. It targets
http://127.0.0.1:7001 (option B); for option A run `pnpm smoke --base http://127.0.0.1:8080`.

Port collisions: if something already listens on 5432, set `POSTGRES_PORT` in `.env` (the bundled
Compose file publishes PostgreSQL on that port) and keep `POSTGRES_PORT` in the service environment
identical.

## Using the dashboard

### First sign-in

A new instance opens on **Set up this instance**. Fill in:

- **Bootstrap token**: the value of `SETUP_BOOTSTRAP_TOKEN` in your `.env`. It proves you control
  the host, so nobody else on the network can claim the instance first.
- **Organization name**, **your name**, **email** and a **password** of at least 12 characters.

That account becomes the owner. Later visits show **Sign in**. If you ran `pnpm smoke` before
opening the dashboard, the smoke test already created the owner: sign in with `SMOKE_EMAIL` and
`SMOKE_PASSWORD` from `.env`.

### Typical first session

1. **Connect a forge** (optional). Open **Connections**, choose **Connect GitHub** or
   **Connect GitLab** and paste a personal access token. For GitHub use a fine-grained token with
   read access to Contents, Metadata and Pull requests; for GitLab a token with the `api` scope. The
   server checks the token against the forge before it saves anything and stores it encrypted.
2. **Create a project.** In **Projects**, either:
   - **Import repository**: browse a connected account's repositories and import one;
   - **Create project**: a project without a repository, which you can bind later;
   - **Start from idea**: describe what you want to build; it is stored as a project in the Idea
     state, named from your text. Planning agents that turn it into a backlog are not connected yet.
3. **Plan the work.** Open the project. The **Tasks** tab is a Kanban board with six lanes:
   Backlog, Ready, In progress, In review, Blocked, Done. Use **Create task**, or type into the
   **Instruction** box at the bottom and press Enter: the instruction becomes a Backlog task, or is
   attached to the task you pick next to it. On a phone the box opens from **Write instruction**.
4. **Move tasks.** Each task offers only the moves the rules allow (pick a lane under **Move to**,
   then **Move**). A refused move shows the server's reason. Open a task to edit it, see its
   acceptance criteria and read its full history, with who moved it and why.
5. **Follow what happens.** The **Activity** tab updates live. **Code** lists the cached commits,
   branches and pull requests; press **Sync repository** to refresh them.

### Other screens

| Screen        | What you do there                                                                         |
| ------------- | ----------------------------------------------------------------------------------------- |
| Overview      | figures and the project ledger for the whole organization, plus warnings and errors       |
| Approvals     | approve or reject queued requests, with an optional decision note recorded with your name |
| Notifications | your inbox; mark items read                                                               |
| Settings      | organization policy: default autonomy, WIP limit per board, audit retention               |

The theme switch is in the top strip (in **Menu** on a phone). The health marker next to it shows
how many services answered and which are not deployed.

### What does not work yet

Agents do not run: nothing picks up a task in **In progress**, and a task cannot reach **Done**
because the quality gate service is a scaffold. Figures that depend on a missing service read
**Unavailable** instead of a number. See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

### Project page

`apps/site` is a static page that introduces the project. `pnpm dev:site` serves it on
http://localhost:5174, and `pnpm --filter @quorumloop/site build` writes a copy to
`apps/site/dist` that works from any path. It is not published anywhere yet.

## Services

Implemented:

| Service                | Port | Owns                                                             |
| ---------------------- | ---- | ---------------------------------------------------------------- |
| api-gateway            | 7001 | no database; public REST surface, SSE relay                      |
| identity-service       | 7002 | users, organizations, memberships, sessions, invitations         |
| project-service        | 7003 | projects, repository bindings, onboarding runs                   |
| settings-service       | 7004 | organization policy and its revision history                     |
| notification-service   | 7005 | in-app notifications, per-member read state                      |
| source-control-service | 7006 | forge connections, repository cache, commit and branch cache     |
| webhook-service        | 7007 | delivery claims, normalized forge events                         |
| task-service           | 7016 | epics, tasks, dependencies, acceptance criteria, history, boards |
| activity-service       | 7018 | activity events, feed projections, stream offsets                |
| audit-service          | 7020 | approval queue, approval decisions, decision notes               |

Scaffolds (build and boot, no domain code yet): workspace 7008, agent-control 7009,
provider-registry 7010, provider-router 7011, orchestration 7012, execution 7013, product-planning
7014, scheduler 7015, quality 7017, usage 7019.

## Commands

| Command                                      | Purpose                                               |
| -------------------------------------------- | ----------------------------------------------------- |
| `pnpm build`                                 | compile every package and service through Turborepo   |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | the gates CI runs                                     |
| `pnpm check`                                 | typecheck, lint and test in one go                    |
| `pnpm format` / `pnpm format:check`          | Prettier write / verify                               |
| `pnpm run setup`                             | generate `.env` from `.env.example` with real secrets |
| `pnpm infra:up` / `pnpm infra:down`          | infrastructure containers only                        |
| `pnpm db:migrate`                            | apply SQL migrations to every owned database          |
| `pnpm dev:core`                              | run the implemented services locally                  |
| `pnpm smoke`                                 | end-to-end check against a running gateway            |
| `pnpm github:setup`                          | apply repository settings and the branch ruleset      |
| `pnpm compose:core`                          | core stack in containers, dashboard on port 8080      |
| `pnpm dev:site`                              | the static project page on port 5174 (`apps/site`)    |

GitHub takes the About metadata, merge options and branch protection from its own settings, not from
the repository. The desired state is therefore kept in files — `.github/repo-settings.json` and
`.github/rulesets/main.json` — and `pnpm github:setup` applies it through the API with a token that
has Administration write; `--dry-run` prints the calls without changing anything. Merges into the
default branch must pass a pull request and the `lint`, `types` and `test` checks; `dependencies` stays
advisory (see `DECISIONS.md` D-13).

## Configuration

`.env.example` documents every variable. `pnpm run setup` copies it and replaces the seven secrets
with generated values; it never prints them. Nothing in the repository contains a real credential,
and `.env` is ignored by Git.

Integrations stay explicitly unconfigured until you fill them in: `GITHUB_APP_*` or
`GITHUB_CLIENT_*` for GitHub, `GITLAB_CLIENT_*` or a personal access token for GitLab,
`PASEO_DAEMON_URL` for Paseo, `ORCA_ENABLED` for Orca. A missing credential disables that
integration with a clear error; it never falls back to a fake result.

## Documentation

| File                                                                         | Contents                                            |
| ---------------------------------------------------------------------------- | --------------------------------------------------- |
| [PRD_QUORUMLOOP.md](PRD_QUORUMLOOP.md)                                       | product requirements, the source of truth for scope |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)                             | phases, dependencies, status per item               |
| [PROGRESS.md](PROGRESS.md)                                                   | what was built, what was verified, what is next     |
| [DECISIONS.md](DECISIONS.md)                                                 | decision log and its rationale                      |
| [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)                                 | unsupported and unfinished capabilities             |
| [DESIGN.md](DESIGN.md)                                                       | visual direction and Anti-Slop review gates         |
| [AGENTS.md](AGENTS.md)                                                       | conventions for contributors and coding agents      |
| [docs/architecture/service-catalog.md](docs/architecture/service-catalog.md) | service boundaries and call graph                   |

## Security

Read [SECURITY.md](SECURITY.md) before deploying. Report vulnerabilities through GitHub private
vulnerability reporting, not a public issue.

The default `.env` produced by `pnpm run setup` is for local development. Before exposing an instance,
set `NODE_ENV=production` (the configuration layer then refuses placeholder secrets), terminate TLS
at a reverse proxy, keep `PUBLIC_BIND=127.0.0.1` unless a proxy fronts it, and review
`CORS_ORIGINS`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Pull requests must keep `pnpm check` and
`pnpm format:check` green.

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE) for third-party attribution.
