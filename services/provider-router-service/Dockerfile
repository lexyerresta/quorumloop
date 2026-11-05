# syntax=docker/dockerfile:1
FROM node:26-alpine AS base
RUN npm install -g pnpm@10.20.0
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@quorumloop/provider-router-service..." build

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN npm install -g pnpm@10.20.0
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/provider-router-service/package.json ./services/provider-router-service/package.json
COPY --from=build /app/services/provider-router-service/dist ./services/provider-router-service/dist
COPY --from=build /app/services/provider-router-service/migrations ./services/provider-router-service/migrations
RUN pnpm install --frozen-lockfile --prod --filter "@quorumloop/provider-router-service..."
USER node
WORKDIR /app/services/provider-router-service
CMD ["node", "dist/main.js"]
