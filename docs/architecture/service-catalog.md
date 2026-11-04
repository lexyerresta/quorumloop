# Quorumloop service catalog

The single source of ports, databases and ownership is `packages/config/src/index.ts`. This
document explains **why** each boundary exists and what it is allowed to depend on. For a service
that is implemented, the event columns list the subscriptions the code actually has; a scaffolded
service lists the contract it is expected to honour. Where those two differ today, the gap is
recorded in `KNOWN_LIMITATIONS.md`.

## Bounded contexts

| #   | Service                     | Port | Database                       | Owns                                                                         | May call (sync)                             | Publishes                                                                                | Consumes                                                           |
| --- | --------------------------- | ---- | ------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | `api-gateway`               | 7001 | none                           | Public HTTP surface, session cookie, CSRF, SSE fan-out, overview aggregation | every service                               | none                                                                                     | none                                                               |
| 2   | `identity-service`          | 7002 | `quorumloop_identity`          | users, organizations, memberships, sessions, invitations                     | none                                        | `identity.*`                                                                             | none                                                               |
| 3   | `project-service`           | 7003 | `quorumloop_project`           | projects, repo binding, onboarding runs                                      | source-control, settings                    | `project.*`                                                                              | `repo.synced`, `task.transitioned`                                 |
| 4   | `settings-service`          | 7004 | `quorumloop_settings`          | organization policy, revisions                                               | none                                        | none yet (see `DECISIONS.md` D-12)                                                       | none                                                               |
| 5   | `notification-service`      | 7005 | `quorumloop_notification`      | in-app notifications, per-member read state                                  | identity                                    | none                                                                                     | `approval.required`, `review.created`                              |
| 6   | `source-control-service`    | 7006 | `quorumloop_source_control`    | forge connections, repository mirrors, commit and review cache               | forge APIs (external)                       | `repo.connected`, `repo.synced`, `review.created`                                        | `task.completed` (branch hint)                                     |
| 7   | `webhook-service`           | 7007 | `quorumloop_webhook`           | delivery dedup, signature verification, normalized forge events              | source-control                              | `repo.synced`, `review.created`                                                          | none                                                               |
| 8   | `workspace-service`         | 7008 | `quorumloop_workspace`         | worktrees, path guard, artifacts, cleanup                                    | source-control (git)                        | `workspace.ready`, `workspace.cleaned`                                                   | `execution.completed`, `execution.failed`                          |
| 9   | `agent-control-service`     | 7009 | `quorumloop_agent_control`     | agent sessions, role profiles, presence, timeline index                      | none                                        | `agent.session.changed`                                                                  | `execution.started`, `execution.completed`, `instruction.received` |
| 10  | `provider-registry-service` | 7010 | `quorumloop_provider_registry` | engine installations, capability snapshots, provider health                  | local CLI probes                            | `provider.status.changed`                                                                | none                                                               |
| 11  | `provider-router-service`   | 7011 | `quorumloop_provider_router`   | routing policy evaluation, cooldown, decision trace                          | provider-registry, settings                 | `provider.limited`, `provider.routed`                                                    | `provider.status.changed`                                          |
| 12  | `orchestration-service`     | 7012 | `quorumloop_orchestration`     | task ownership, fenced leases, workflow runs, checkpoints                    | task, workspace, provider-router, execution | `execution.leased`                                                                       | `task.ready`, `quality.completed`, `execution.*`                   |
| 13  | `execution-service`         | 7013 | `quorumloop_execution`         | runner handoff, Paseo/Orca/CLI adapters, transcripts                         | workspace, provider-registry, orchestration | `execution.started`, `execution.checkpointed`, `execution.failed`, `execution.completed` | `execution.leased`                                                 |
| 14  | `product-planning-service`  | 7014 | `quorumloop_product_planning`  | ideas, PRD proposals, roadmap and sprint planning                            | task, agent-control                         | `planning.proposed`                                                                      | `project.created`                                                  |
| 15  | `scheduler-service`         | 7015 | `quorumloop_scheduler`         | scheduled runs, heartbeats, backlog wake-up, retry budget                    | orchestration, task                         | `scheduler.tick`                                                                         | `execution.completed`, `execution.failed`                          |
| 16  | `task-service`              | 7016 | `quorumloop_task`              | epics, tasks, Kanban state, dependencies, history                            | settings, quality                           | `task.created`, `task.ready`, `task.completed`                                           | `quality.completed`, `execution.completed`                         |
| 17  | `quality-service`           | 7017 | `quorumloop_quality`           | test evidence, Anti-Slop gate, a11y and security outcomes                    | workspace, execution                        | `quality.completed`                                                                      | `execution.checkpointed`                                           |
| 18  | `activity-service`          | 7018 | `quorumloop_activity`          | sanitized activity feed, projections, SSE cursor                             | none                                        | none                                                                                     | every `quorumloop.*` domain event                                  |
| 19  | `usage-service`             | 7019 | `quorumloop_usage`             | usage telemetry, cost estimates, budgets                                     | provider-registry                           | none                                                                                     | `execution.completed`, `provider.limited`                          |
| 20  | `audit-service`             | 7020 | `quorumloop_audit`             | approval queue and decisions                                                 | none                                        | none                                                                                     | `approval.required`, plus direct writes from the decision endpoint |

## Dependency rules

1. **No shared tables.** A service reaches another only through `/internal/*` on the signed
   internal API, or by consuming the event stream.
2. **No cycles in synchronous calls.** The table above is a DAG. Events may flow backwards
   (`quality.completed` informs `task-service`) because events are asynchronous and idempotent.
3. **The gateway owns no state.** It may cache for a few seconds, never authoritatively.
4. **Deep chains are capped at two hops.** Gateway → task → settings is the longest allowed
   synchronous path. Anything longer becomes an event.
5. **Forge and provider calls never leave their adapter.** `source-control-service` is the only
   service holding forge credentials; `execution-service` is the only one starting engines.

## Event ownership

`contracts/src/events/catalog.ts` is the schema authority. A producer may only publish the
events it owns in this table; a consumer validates the payload before applying it.

| Subject                                                                              | Producer                 | Primary consumers                                        |
| ------------------------------------------------------------------------------------ | ------------------------ | -------------------------------------------------------- |
| `quorumloop.project.created.v1`                                                      | project                  | activity, planning                                       |
| `quorumloop.repo.connected.v1` / `repo.synced.v1`                                    | source-control, webhook  | project, activity                                        |
| `quorumloop.task.created.v1` / `task.ready.v1` / `task.completed.v1`                 | task                     | activity, orchestration, project                         |
| `quorumloop.instruction.received.v1`                                                 | gateway, agent-control   | activity, execution                                      |
| `quorumloop.execution.leased.v1`                                                     | orchestration            | execution, activity                                      |
| `quorumloop.execution.started.v1` / `checkpointed.v1` / `failed.v1` / `completed.v1` | execution                | activity, task, quality, usage, scheduler, agent-control |
| `quorumloop.provider.limited.v1`                                                     | provider-router          | notification, usage, activity                            |
| `quorumloop.quality.completed.v1`                                                    | quality                  | task, orchestration, activity, notification              |
| `quorumloop.review.created.v1`                                                       | source-control           | activity, project                                        |
| `quorumloop.approval.required.v1`                                                    | any policy-bound service | notification, activity, audit                            |
| `quorumloop.agent.session.changed.v1`                                                | agent-control            | activity                                                 |
| `quorumloop.planning.proposed.v1`                                                    | product-planning         | activity, task                                           |

## Compose profiles

| Profile | Services                                                                                                                  | Purpose                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `core`  | postgres, redis, nats, gateway, identity, project, settings, task, source-control, webhook, activity, web, and the runner | Smallest honest install: onboarding, Kanban, real commits.          |
| `full`  | all twenty services                                                                                                       | Everything, including orchestration, execution, planning and usage. |
| `demo`  | `core` plus `DEMO_MODE=true`                                                                                              | Seed data that is labelled as demo in the interface.                |
