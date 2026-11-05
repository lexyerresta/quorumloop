# syntax=docker/dockerfile:1
FROM node:26-alpine AS base
RUN npm install -g pnpm@10.20.0
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@quorumloop/product-planning-service..." build

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN npm install -g pnpm@10.20.0
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/product-planning-service/package.json ./services/product-planning-service/package.json
COPY --from=build /app/services/product-planning-service/dist ./services/product-planning-service/dist
COPY --from=build /app/services/product-planning-service/migrations ./services/product-planning-service/migrations
RUN pnpm install --frozen-lockfile --prod --filter "@quorumloop/product-planning-service..."
USER node
WORKDIR /app/services/product-planning-service
CMD ["node", "dist/main.js"]
