# ADR-006: Runner isolation

- **Status:** Accepted
- **Date:** 2026-11-04
- **Context:** Agent CLIs execute model-authored instructions on a checkout. They write files, run package managers and start servers. A bug or a hostile prompt must not reach the Docker socket, the host filesystem or another tenant's repository.
- **Decision:**
  - `workspace-service` and `execution-service` run as a separate `runner` Compose profile with its own container image, its own volume for `/workspace`, and **no Docker socket mount**.
  - Every path is resolved against `WORKSPACE_ROOT`, normalized, and rejected if it escapes the root (`pathGuard`), including symlink resolution. Work happens in git worktrees, one per task attempt, never in a shared checkout.
  - Engines are started as child processes with an explicit argument array (never a shell string), a bounded cwd, a wall-clock timeout, a turn limit and a captured exit status. Provider credentials are read from the environment and never written into a workspace.
  - Execution is disabled by default (`EXECUTION_ENABLED=false`). Turning it on is a deliberate operator action.
  - Destructive or irreversible actions (publish repository, deploy production, change credentials, delete remote data) create an approval request instead of executing; see ADR-008 and the approval contract.
- **Consequences:**
  - A compromised agent can damage only its own worktree.
  - Long running agents need checkpoints rather than a long-lived connection; see ADR-008.
  - Operators must size the runner volume and clean up worktrees; `workspace-service` owns cleanup and reports leaked directories.
- **Rejected:** mounting the Docker socket (container escape by design), running agents in the API process (a crash takes the API down), trusting the model's paths (unvalidated input).
