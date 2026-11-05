# syntax=docker/dockerfile:1
# Builds the dashboard and publishes it into the `webdist` volume, which the gateway serves from
# WEB_DIST_DIR (infrastructure/compose/compose.core.yml). The container holds no server of its own.
FROM node:26-alpine AS build
RUN npm install -g pnpm@10.20.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter "@quorumloop/web..."
RUN pnpm --filter "@quorumloop/web..." build

FROM alpine:3.22 AS publish
COPY --from=build /app/apps/web/dist /dist
# Replace the volume content on every start so an upgrade never serves a stale bundle, then idle.
CMD ["sh", "-c", "rm -rf /out/* && cp -R /dist/. /out/ && echo 'dashboard published to /out' && exec sleep 2147483647"]
