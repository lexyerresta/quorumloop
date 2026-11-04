# ADR-002: Twenty domain boundaries

- **Status:** Accepted
- **Date:** 2026-11-04
- **Context:** The platform mixes platform concerns (identity, policy, notifications), forge integration (repositories, webhooks, worktrees), AI execution (agents, providers, orchestration, execution, planning) and management views (tasks, quality, activity, usage, audit). Each has a different failure mode and change cadence.
- **Decision:** Twenty independently deployable services, each owning one bounded context and one database. Service names, ports, databases and data ownership are declared once in `packages/config/src/index.ts` and mirrored in `docs/architecture/service-catalog.md`.
  - Platform: `api-gateway`, `identity-service`, `project-service`, `settings-service`, `notification-service`.
  - Forge: `source-control-service`, `webhook-service`, `workspace-service`.
  - AI: `agent-control-service`, `provider-registry-service`, `provider-router-service`, `orchestration-service`, `execution-service`, `product-planning-service`, `scheduler-service`.
  - Management: `task-service`, `quality-service`, `activity-service`, `usage-service`, `audit-service`.
- **Consequences:**
  - A service can be replaced or scaled without touching the others.
  - No service reads another service's tables; every cross-boundary read is an internal API call or an event subscription.
  - Latency budget: a gateway request may chain at most two internal hops.
  - Operational cost is real: twenty containers, twenty roles, twenty migration sets. Compose profiles (`core`, `full`, `demo`) let a small install run the subset it needs.
- **Rejected:** modular monolith (explicitly out of scope), fewer coarser services (would merge owners of the same table), one shared database (destroys ownership).
