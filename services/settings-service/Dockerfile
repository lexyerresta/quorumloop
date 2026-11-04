# syntax=docker/dockerfile:1
FROM node:26-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@quorumloop/settings-service..." build

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/settings-service/package.json ./services/settings-service/package.json
COPY --from=build /app/services/settings-service/dist ./services/settings-service/dist
COPY --from=build /app/services/settings-service/migrations ./services/settings-service/migrations
RUN pnpm install --frozen-lockfile --prod --filter "@quorumloop/settings-service..."
USER node
WORKDIR /app/services/settings-service
CMD ["node", "dist/main.js"]
