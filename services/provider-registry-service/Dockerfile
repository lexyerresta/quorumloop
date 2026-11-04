# syntax=docker/dockerfile:1
FROM node:26-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@quorumloop/provider-registry-service..." build

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/provider-registry-service/package.json ./services/provider-registry-service/package.json
COPY --from=build /app/services/provider-registry-service/dist ./services/provider-registry-service/dist
COPY --from=build /app/services/provider-registry-service/migrations ./services/provider-registry-service/migrations
RUN pnpm install --frozen-lockfile --prod --filter "@quorumloop/provider-registry-service..."
USER node
WORKDIR /app/services/provider-registry-service
CMD ["node", "dist/main.js"]
