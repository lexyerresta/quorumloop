# ADR-005: PostgreSQL ownership per service

- **Status:** Accepted
- **Date:** 2026-11-04
- **Context:** Twenty services need persistence without a shared schema. Alternating between "one database" and "one database per service" late in a project is expensive.
- **Decision:**
  - One PostgreSQL cluster for a self-hosted install, but one **database and one role per owning service**: `quorumloop_identity`, `quorumloop_project`, and so on. The role owns only its database and has no rights on the others.
  - `infrastructure/postgres/init/001-databases.sh` creates roles and databases from the service catalog, so adding a service is a catalog change plus a migration set.
  - Drizzle ORM per service with each service exporting its own `DatabaseModule` and schema. Drizzle SQL migrations live in `services/<name>/migrations` and run through `runSqlMigrations` with a Postgres advisory lock, guarded by `AUTO_MIGRATE`.
  - `api-gateway` owns no database. It aggregates through internal APIs.
- **Consequences:**
  - Ownership is enforced by credentials, not by convention. A cross-service `join` is impossible to write by accident.
  - Backup and restore is per database, and a compromised service cannot read another's data.
  - Reporting queries that span services must be assembled at the gateway; there is no read replica trick available.
- **Rejected:** schema-per-service in one database (a single role would still read everything), one shared schema (ownership becomes documentation only).
