# ADR-009: Licence strategy and third-party attribution

- **Status:** Accepted
- **Date:** 2026-11-04
- **Context:** Quorumloop is meant to be published as a public repository and installed by others. It integrates with vendor CLIs and SDKs under their own terms, and vendors Anti-Slop design guidance from an MIT-licensed project.
- **Decision:**
  - The repository is licensed **Apache-2.0**: it grants patent use, requires attribution of modified files, and is compatible with the MIT and ISC dependencies in the tree.
  - `NOTICE` lists vendored or adopted third-party material: the Anti-Slop rules in `docs/antislop/antislop.md` (MIT, upstream pinned), Paseo client packages, and the trademark notice that Quorumloop is not affiliated with Anthropic, OpenAI, OpenCode, Qoder, Paseo or Orca.
  - No vendor source code, prompts or assets are copied. Integrations call documented CLIs and published SDKs, and each adapter documents the exact commands it runs.
  - `docs/security.md`, `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md` ship with the first public release; `SECURITY.md` defines private disclosure.
  - Dependencies are audited in CI (`pnpm audit`, licence check) and a new dependency needs a stated reason in the pull request.
- **Consequences:**
  - Downstream users may deploy Quorumloop commercially, which matches the self-hosted intent.
  - Apache-2.0 requires keeping attribution notices; the build must not strip `NOTICE`.
  - Trademarks of integrated vendors stay theirs; the README states no affiliation.
- **Rejected:** AGPL (deters commercial self-hosting and is a heavier obligation for contributors), MIT (no patent grant), no licence (not open source).
