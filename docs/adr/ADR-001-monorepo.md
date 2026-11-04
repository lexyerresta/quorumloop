# ADR-001: Single monorepo with pnpm workspaces and Turborepo

- **Status:** Accepted
- **Date:** 2026-11-04
- **Context:** Twenty services, a dashboard and shared contracts must version together. Independent repositories would force a publish step for every contract change and make cross-service refactors unsafe during the build-out phase.
- **Decision:** One Git repository. pnpm workspaces for linking, Turborepo for task orchestration and caching. Workspace layout: `apps/`, `services/`, `packages/`, `infrastructure/`, `docs/`, `scripts/`. One lockfile, one Node version, one TypeScript baseline.
- **Consequences:**
  - A contract change and its consumers land in one commit, so the compiler proves consistency across services.
  - Every service still has its own `package.json`, `Dockerfile` and build output, so deployability stays independent.
  - CI must use `--filter` to avoid building twenty services for a one-file change; `turbo.json` declares `dependsOn: ["^build"]` so shared packages build first.
  - A repository-wide lockfile means a dependency upgrade touches every service; this is intentional and reviewed as one change.
- **Rejected:** polyrepo (contract drift, painful local development), Nx (heavier preset surface than needed), npm workspaces (slower installs, weaker filtering).
