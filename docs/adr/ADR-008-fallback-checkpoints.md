# ADR-008: Provider fallback, fenced leases and durable checkpoints

- **Status:** Accepted
- **Date:** 2026-11-04
- **Context:** Agent providers rate-limit, run out of quota and fail mid-task. A retry that starts from zero wastes the most expensive part of the work, and two orchestrators acting on one task corrupt its history.
- **Decision:**
  - **Routing:** `provider-router-service` evaluates a policy (`priority_then_fallback`), a health snapshot and a cooldown table, then records a decision trace with the reason for every rejection. `fallback_on` and `never_fallback_on` are explicit; `never_fallback_on` includes `policy_violation` and `auth_failure` so a broken credential does not silently burn every provider.
  - **Leases:** `orchestration-service` grants a fenced lease with an incrementing `fence` token and an expiry. Any write from a runner must present the current fence; a stale runner is rejected rather than overwriting.
  - **Checkpoints:** every run persists checkpoints (branch, head sha, plan position, transcript cursor, artifacts). A retry resumes from the newest checkpoint on a different engine when allowed, and reports `resumed_from` so the timeline shows the handoff.
  - **Bounded retries:** `MAX_RETRIES_PER_ENGINE` per engine and a total attempt cap per task. Exhausting both moves the task to `needs_human_approval` with the collected evidence; the loop never spins.
- **Consequences:**
  - A provider limit costs a cooldown, not a task.
  - Lease fencing makes duplicate execution safe instead of "unlikely".
  - Checkpoints cost storage; `workspace-service` prunes them with the worktree they describe.
- **Rejected:** unlimited retry (unbounded spend), resume from scratch (wasted work), advisory locking without a fence (stale writer wins).
