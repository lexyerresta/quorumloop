# Security policy

## Supported versions

Quorumloop has not made a stable release yet. Only the `main` branch receives security fixes; there
are no maintained older branches. Pin a commit or tag if you need a frozen build.

## Reporting a vulnerability

Report privately through GitHub: **Security** tab → **Report a vulnerability**
(private vulnerability reporting). Do not open a public issue, discussion or pull request for a
suspected vulnerability.

Please include:

- affected service, endpoint or file, and the commit you tested
- what an attacker gains, and the preconditions (network position, session, role)
- reproduction steps or a proof of concept that does not touch other people's data
- whether the issue reproduces with a default `pnpm setup` environment

Expect an acknowledgement within 7 days and an assessment within 14 days. A fix, mitigation or an
explicit "will not fix" with reasoning follows. Credit is given in the advisory unless you ask
otherwise. This project has no bug bounty and cannot pay for reports.

## Scope

In scope: the code in this repository, the default configuration produced by `pnpm setup`, and the
Compose files under `infrastructure/`.

Out of scope: vulnerabilities in PostgreSQL, Redis, NATS, Docker, Node.js or any vendor CLI,
provider or forge you connect to; findings that require a modified `.env` that weakens a documented
default; social engineering; denial of service from unbounded resource use on your own host;
missing hardening headers on a deployment that does not follow the checklist below.

## Security design in this codebase

These are the controls that exist in code today. Treat anything not listed here as absent.

| Control                                                                                                                               | Where                                                |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Session cookie is `HttpOnly`; unsafe methods also require a matching `x-csrf-token` header (double submit against the stored session) | `services/api-gateway/src/gateway/session.guard.ts`  |
| Internal calls are signed with HMAC-SHA256 over caller, method, path, timestamp and body hash, with a 120 s skew window               | `packages/platform/src/crypto/internal-signature.ts` |
| Passwords are hashed with `scrypt` and a per-user salt                                                                                | `packages/platform/src/crypto`                       |
| Forge tokens and app credentials are sealed with AES-256-GCM before storage                                                           | `services/source-control-service`                    |
| Webhook payloads are verified against the raw body: GitHub HMAC-SHA256, GitLab token                                                  | `services/webhook-service/src/ingest/signature.ts`   |
| Webhook deliveries are deduplicated by delivery id before any side effect                                                             | `services/webhook-service`                           |
| Forge base URLs are validated to block SSRF against internal addresses                                                                | `services/source-control-service`                    |
| Event payloads are checked for secret-shaped values before they enter the outbox                                                      | `packages/contracts` (`assertNoSecrets`)             |
| `NODE_ENV=production` refuses placeholder secrets                                                                                     | `packages/config/src/index.ts`                       |
| One database role per service; a service cannot read another service's tables                                                         | `infrastructure/postgres/init/001-databases.sh`      |

## Deploying safely

The defaults are for a single developer's machine. Before exposing an instance:

1. Set `NODE_ENV=production` and regenerate every secret with `pnpm setup --force`.
2. Terminate TLS at a reverse proxy and keep the gateway bound to loopback (`PUBLIC_BIND=127.0.0.1`)
   unless the proxy fronts it.
3. Set `APP_ORIGIN` and `CORS_ORIGINS` to the exact public origin. Do not use wildcards.
4. Replace the bundled PostgreSQL, Redis and NATS credentials; nothing in `.env.example` is a
   secret.
5. Restrict egress from the host or cluster if you connect to a self-managed GitLab; set
   `GITLAB_ALLOWED_HOSTS` explicitly.
6. Take backups of each service database. Migrations are expand-contract, but rolling back the
   application does not roll back a schema change.
7. Leave `EXECUTION_ENABLED=false` until you have reviewed what an agent is allowed to run on the
   host.

## Handling credentials

- `.env` is ignored by Git and must never be committed. `pnpm setup` generates it and prints no
  secret values.
- Rotating `POSTGRES_SERVICE_PASSWORD` requires updating the database roles as well
  (`ALTER ROLE ... PASSWORD`, or a fresh PostgreSQL volume). The init script only runs on first
  initialisation, so a password rotation is a planned migration, not just a new `.env`.
- Vendor credentials are stored encrypted, but the encryption key lives in `SECRET_ENCRYPTION_KEY`.
  Losing it makes stored forge tokens unreadable; leaking it alongside a database dump compromises
  them.
- If a credential is exposed, rotate it at the provider first, then re-enter it in Quorumloop.
  Rotating at the provider immediately invalidates the leaked value even if it is still stored
  locally.
