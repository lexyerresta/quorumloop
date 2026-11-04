# AGENTS.md

You are implementing **Quorumloop**, an open-source, self-hosted AI development
orchestration platform. `PRD_QUORUMLOOP.md` is the authoritative scope. If this file and the
PRD disagree, the PRD wins and the conflict is recorded in `DECISIONS.md`.

## Non-negotiable rules

1. Do not fabricate provider support, repository state, test results, credits, costs, or
   metrics. Unconfigured integrations show `Not connected`, `Unsupported`, or `Experimental`.
2. Never cross repository or organization boundaries. Every write is scoped by `org_id` and
   ownership checked at the service that owns the data.
3. Never bypass subscription limits, rate limits, or security policy. Fallback only moves
   between officially supported, authenticated engines, and only after a valid checkpoint.
4. Maintain `IMPLEMENTATION_PLAN.md`, `PROGRESS.md`, `DECISIONS.md`, `KNOWN_LIMITATIONS.md`,
   and `DESIGN.md`. Update them in the same change as the code they describe.
5. Use only documented SDK and CLI APIs. Perform capability detection. Do not invent methods.
6. Follow the NestJS-native Clean Architecture layering in PRD section 4.3 and use CQRS
   selectively, never as ceremony for simple CRUD.
7. Prefer a runnable vertical slice over broad nonfunctional scaffolding. A scaffolded
   service is not a finished service and must be reported as scaffolded.
8. Do not publish repositories, deploy to production, merge protected branches, spend money,
   delete non-ephemeral data, or change host security without explicit owner approval.
9. Record blockers instead of inventing workarounds. Bounded retries only.

## Architecture quick reference

- One Git monorepo, pnpm workspace plus Turborepo. Frontend `apps/web` is not a service.
- 20 deployable backend services in `services/`. `api-gateway` is service 01.
- Per service: `presentation` (Nest controllers, NATS handlers, DTO mapping), `application`
  (use cases, selective commands and queries, ports), `domain` (entities, invariants, events,
  no framework imports), `infrastructure` (Drizzle, NATS, forge, runtime adapters bound by DI
  tokens).
- PostgreSQL with one database and one role per service. No cross-service joins, no shared
  ORM package. Cross-service references are logical IDs.
- NATS Core for request/reply, JetStream for durable events, transactional outbox plus
  idempotent inbox for every durable producer and consumer.
- One fenced execution lease per task. `orchestration-service` is the only task controller.

## Commands

```
pnpm install
pnpm build          # turbo: packages, services, web
pnpm typecheck
pnpm lint
pnpm test
pnpm test:contracts
pnpm dev:core       # infrastructure + core services + web
pnpm dev:web
pnpm db:migrate
```

## UI rules

Before any UI work read `DESIGN.md` (direction) and `docs/antislop/antislop.md` (filter),
then the skills under `docs/antislop/skills/`. Run the four-block Delivery Gate before
delivering UI and write the result to `docs/quality/anti-slop-gate.md`. Keep the gate honest:
a PASS needs evidence from a build or a recorded click-through.

<!-- antislop:start -->

## antislop

For UI, copy, people, mobile layout, or code comments work, read `docs/antislop/antislop.md`
(core) and then the skill for the task:

- UI / visual: `docs/antislop/skills/antislop-ui/SKILL.md`
- Copy & text: `docs/antislop/skills/antislop-copywriting/SKILL.md`
- People: `docs/antislop/skills/antislop-human/SKILL.md`
- Mobile / responsive: `docs/antislop/skills/antislop-layoutmobile/SKILL.md`
- Code comments: `docs/antislop/skills/antislop-code/SKILL.md`

Before starting, follow the core's "Two Usage Modes" section in strict order: explicit session
instruction first, then global preference, then ask. A session instruction always wins. A
request to review, audit, or avoid file edits does not select a mode. If the mode is
unresolved, ask during/after and wait for the answer before any UI review, planning, or
concept. To update antislop later, replace the core file and skills with the same release.
<!-- antislop:end -->
