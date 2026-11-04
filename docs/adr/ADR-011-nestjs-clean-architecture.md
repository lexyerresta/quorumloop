# ADR-011: NestJS Clean Architecture, feature modules and selective CQRS

- **Status:** Accepted
- **Date:** 2026-11-04
- **Context:** Twenty services share NestJS, but a service must stay small enough to read in one sitting. Copying a heavy four-layer template into every service would produce ceremony without benefit, while ad-hoc controllers calling tables directly would lose testability on the workflows that matter.
- **Decision:**
  - Each service is one NestJS feature module tree. Dependency direction is inward only: `interface (controller, consumer, scheduler)` → `application (use case)` → `domain (entity, policy, port)` ← `infrastructure (postgres repository, adapter)`.
  - Ports are declared next to the domain as TypeScript interfaces and bound to adapters in the module. No domain file imports Drizzle, Fastify, NATS or another service's package.
  - DTOs are Zod schemas in `@quorumloop/contracts` (cross-service) or in the service's `contracts` folder (internal). The controller parses with the schema and passes a typed value inward, so no `any` reaches the use case.
  - **CQRS is selective.** `@nestjs/cqrs` is used where a command spans several aggregates or emits domain events that must be written to the outbox atomically: task transitions, execution lease and checkpoint lifecycle, provider routing decisions, approval decisions, planning proposal acceptance. Plain CRUD (list projects, read a task, notification reads, activity queries) uses a repository call from a thin service class. No command/handler pair is created for a single `insert`.
  - Guards and interceptors are global and cross-cutting only: `InternalAuthGuard` for service identity, a gateway session guard, a CSRF interceptor, one exception filter, one request-context middleware.
  - A neutral `packages/platform` package holds the runtime plumbing every service repeats (bootstrap, health, signed HTTP client, outbox/inbox, crypto, ids). It contains no domain knowledge and no service-to-service logic.
- **Consequences:**
  - A reviewer can find the rule for a behaviour in `domain`, and the effect in `application`.
  - Services without a complex workflow have no `commands` folder at all; that is intentional, not unfinished.
  - Adding CQRS later means adding a handler, not rewriting the module.
- **Rejected:** CQRS everywhere (two files per trivial read), Laravel-style service/repository folders at the root (loses module boundaries), an anaemic controller that queries tables directly (untestable workflow logic).
