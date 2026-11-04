# Contributing to Quorumloop

Thanks for helping. This document describes how the repository is built, what a change must satisfy,
and where to start.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues go through
[SECURITY.md](SECURITY.md), never a public issue.

## Before you start

Open an issue before writing code for anything larger than a bug fix or a documentation correction.
For a scaffolded service (listed in [README.md](README.md#services)) the issue should state which
endpoints, tables and events the service will own, because service boundaries are the expensive
thing to change later.

## Development setup

```bash
corepack enable
pnpm install
pnpm setup
pnpm infra:up
pnpm build
pnpm db:migrate
pnpm dev:core --compiled --no-web
```

`pnpm dev:core --only identity-service,task-service` starts a subset. On a machine with limited
memory, keep `--compiled`; without it every service runs its own `tsx watch` process.

## What CI requires

Every pull request must pass:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm check` runs typecheck, lint and test together. Do not weaken a gate to make a change pass: no
disabled rules, no skipped tests, no `@ts-expect-error` used as a silence, no lowered coverage
thresholds. If a gate is wrong, fix the gate in its own pull request.

## Code conventions

- TypeScript strict mode, `noUncheckedIndexedAccess` included. Prefer explicit types at module
  boundaries and let inference work inside a function.
- Follow the existing structure: a NestJS module per feature area, controller → service (command or
  query handler) → repository, with DTOs validated by zod schemas from `@quorumloop/contracts`.
- Shared behaviour belongs in `packages/*`. Never copy a helper from one service into another; move
  it to a package and import it.
- A service owns its data. Cross-service reads use `ServiceClient` over signed internal HTTP;
  cross-service reactions use events. Reading another service's tables is not a shortcut, it is a
  defect.
- Publishing an event means writing to the outbox inside the same transaction as the state change.
  Never publish directly to NATS from a request handler.
- SQL migrations are expand-contract and live in `services/<name>/migrations`, ordered by filename.
  A migration that drops a column readers still use is rejected.
- Changing an event or API contract means changing `packages/contracts` and its contract tests in
  the same pull request. Consumers must tolerate the new shape before producers rely on it.
- Comments explain why, not what. Match the surrounding comment density; do not narrate obvious
  code.
- UI work follows [DESIGN.md](DESIGN.md) and the vendored Anti-Slop rules. A UI pull request states
  the design intent and the review evidence, and must not ship decorative filler, fake
  interactions, or placeholder data presented as real.

## Tests

- Unit tests sit in `test/` next to the source they cover and run with `vitest`.
- Domain rules deserve table-driven tests: transition matrices, DAG cycle detection, routing
  priority, signature verification, cursor pagination.
- Tests must not require Docker, a live database, or network access. Use the pure rules module or a
  fake port.
- Do not assert on log text or internal call order where a behavioural assertion is possible.

## Data honesty

Quorumloop is an orchestration platform, so its own repository must not fake operational facts:

- Never commit demo data, fixtures or screenshots that present simulated agent activity, commit
  history, pull requests or provider usage as real. When a demo dataset exists, label it `demo` in
  the payload and in the UI.
- A failing integration reports that it is unavailable or unconfigured. It must not silently fall
  back to a canned success.
- Pull request descriptions state what was actually run. "Not run" is an acceptable answer; "passing"
  without evidence is not.

## Dependencies

A new runtime dependency needs a reason in the pull request: what it does, why the standard library
or an existing dependency cannot, its license, and its maintenance state. Prefer the package the
ecosystem already uses (for example the NestJS-first option) over a parallel implementation.

## Pull requests

1. Branch from `main` and keep the branch focused on one change.
2. Write a description that covers: the problem, the approach, what you ran to verify it, and any
   follow-up you deliberately left out.
3. Update the relevant documents in the same pull request: `IMPLEMENTATION_PLAN.md` status,
   `PROGRESS.md`, `KNOWN_LIMITATIONS.md`, and an ADR when you make an architectural decision.
4. Keep commits reviewable. Squash merging is enabled, so intermediate commits may be small.
5. Do not include generated build output, `.env` files, credentials, or editor-specific settings.

A reviewer will check correctness, service-boundary discipline, test coverage of the changed rules,
documentation accuracy, and that no operational facts were invented.

## Where to start

Good first contributions, in rough order of difficulty:

- Documentation corrections where the docs and the code disagree (report first, then fix).
- Additional unit tests for existing domain rules.
- A gateway route or DTO that the PRD specifies but the catalogue does not yet expose.
- One of the scaffolded services, taken from the catalogue and implemented end to end.
