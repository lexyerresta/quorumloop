# ADR-007: Paseo as primary runtime, Orca opt-in through a separate adapter

- **Status:** Accepted
- **Date:** 2026-11-04
- **Context:** Paseo is the specified AI lead runtime and speaks a daemon protocol; Orca is an optional orchestration layer with a different lifecycle. Neither exposes a stable capability surface that can be assumed.
- **Decision:**
  - `execution-service` defines one `RuntimeAdapter` port: `capabilities()`, `start(run)`, `observe(runId)`, `sendInstruction(runId, text)`, `stop(runId)`.
  - `PaseoRuntimeAdapter` is the primary implementation and talks to `PASEO_DAEMON_URL` using `@getpaseo/client`. It is only constructed when that URL is configured; otherwise the adapter reports `unconfigured` rather than pretending to run.
  - `OrcaRuntimeAdapter` lives in its own module and is only wired when `ORCA_ENABLED=true`. It never imports Paseo internals and never shares state.
  - Capability detection is real: each adapter publishes a `EngineCapability` snapshot (headless prompt, stream json, permission modes, max turns, workspace cwd, native Paseo provider, Orca compatible). The dashboard renders only what a probe confirmed.
  - Anything the installed SDK does not support stays unimplemented and is recorded in `KNOWN_LIMITATIONS.md`; no method is invented.
- **Consequences:**
  - A missing daemon produces a visible `unconfigured` state in the UI, not an empty success.
  - Adapters can be swapped without touching orchestration.
  - Two runtimes means two test matrices; only Paseo has an end-to-end path until an Orca installation exists.
- **Rejected:** one adapter with runtime flags (leaks one vendor's model into the other), direct CLI calls as the only integration (loses Paseo's session and event stream).
