# syntax=docker/dockerfile:1
FROM node:26-alpine AS base
RUN npm install -g pnpm@10.20.0
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@quorumloop/api-gateway..." build

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN npm install -g pnpm@10.20.0
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/api-gateway/package.json ./services/api-gateway/package.json
COPY --from=build /app/services/api-gateway/dist ./services/api-gateway/dist
RUN pnpm install --frozen-lockfile --prod --filter "@quorumloop/api-gateway..."
USER node
WORKDIR /app/services/api-gateway
CMD ["node", "dist/main.js"]
