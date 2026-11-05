# syntax=docker/dockerfile:1
FROM node:26-alpine AS base
RUN npm install -g pnpm@10.20.0
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@quorumloop/activity-service..." build

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN npm install -g pnpm@10.20.0
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/activity-service/package.json ./services/activity-service/package.json
COPY --from=build /app/services/activity-service/dist ./services/activity-service/dist
COPY --from=build /app/services/activity-service/migrations ./services/activity-service/migrations
RUN pnpm install --frozen-lockfile --prod --filter "@quorumloop/activity-service..."
USER node
WORKDIR /app/services/activity-service
CMD ["node", "dist/main.js"]
