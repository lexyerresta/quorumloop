# ADR-003: Node.js 26 LTS, NestJS and Fastify

- **Status:** Accepted
- **Date:** 2026-11-04
- **Context:** The PRD fixes NestJS with Fastify on Node.js 26 LTS. NestJS supplies the module system, dependency injection and lifecycle hooks the microservice split depends on; Fastify supplies throughput and a small HTTP surface.
- **Decision:** `@nestjs/core`, `@nestjs/common` and `@nestjs/platform-fastify` at `12.3.2`, Fastify `5.12.8`, CommonJS output with `experimentalDecorators` and `emitDecoratorMetadata`. Dockerfiles pin `node:26-alpine`; `engines.node` is `>=24` so a developer on the current machine can build and test while containers use 26.
- **Local environment note:** the development machine used to build this repository runs Node 24.12.0. Node 26 behaviour is therefore not verified here; that gap is recorded in `KNOWN_LIMITATIONS.md` and closed by the Docker build in CI, which is the deployment target anyway.
- **Consequences:**
  - Fastify's `trustProxy`, `bodyLimit` and `disableRequestLogging` are configured once in `packages/platform`, so every service shares the same HTTP posture.
  - Raw request bodies are enabled globally because webhook signature verification needs the exact bytes GitHub and GitLab signed.
  - CommonJS avoids the dual-package hazard between NestJS's decorator metadata and ESM-only helpers. The browser app never imports these packages at runtime; it imports contract types only.
- **Rejected:** Express (slower, no benefit here), ESM output for services (decorator metadata plus interop is a source of subtle breakage), transpile-only builds (type errors must block the build).
