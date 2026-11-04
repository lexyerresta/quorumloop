# What this changes

<!-- One paragraph. The problem, and the approach you took. -->

## Why

<!-- Link the issue or ADR. If there is no issue, explain the defect or need. -->

## What was verified

<!-- Paste the commands you actually ran and what they printed. "Not run" is a valid answer. -->

- [ ] `pnpm format:check`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm smoke` against a running stack (when the change touches a runtime path)

## Service boundaries

<!-- Which services own the data this change touches? Any new internal call, event, or subscription?
     Reads must go over signed internal HTTP; reactions must go over NATS. -->

## Contracts and migrations

- [ ] No change to `packages/contracts`
- [ ] Contract changed and its tests updated in this pull request
- [ ] No migration
- [ ] Migration added under `services/<name>/migrations` and it is expand-contract

## Honesty checklist

- [ ] No credential, token, cookie or real customer data is included
- [ ] No fabricated test output, provider usage, agent activity, commit history or screenshots
- [ ] Any demo or seeded data is labelled as demo in the payload and in the UI
- [ ] An unavailable integration reports itself as unconfigured or unavailable, with no silent
      fallback to a canned success
- [ ] Documentation updated when behaviour or status changed: `IMPLEMENTATION_PLAN.md`,
      `PROGRESS.md`, `KNOWN_LIMITATIONS.md`, `README.md`, or an ADR
