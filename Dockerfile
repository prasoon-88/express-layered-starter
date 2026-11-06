# syntax=docker/dockerfile:1

# Major version only: keep it equal to .nvmrc. Rebuilding picks up Node and Alpine security fixes.
ARG NODE_VERSION=26

# ---- base: pnpm, at the version "packageManager" in package.json pins ----
FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
# Node 25 stopped bundling Corepack, so it is installed from npm.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install --global corepack@0.34.6 && corepack enable pnpm
COPY package.json pnpm-lock.yaml .npmrc ./

# ---- build: all dependencies, then compile src/ to dist/ ----
FROM base AS build
# --ignore-scripts: "preinstall" (only-allow) and "prepare" (husky) are for developer machines.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
RUN pnpm run build

# ---- prod-deps: runtime dependencies only ----
FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# ---- runtime: no pnpm, no compiler, no src/ ----
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Owned by root: the app user can read its code but not rewrite it.
# package.json is needed at runtime: Node resolves the #imports map from it.
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public

USER node
EXPOSE 8000

# Liveness, not readiness: Docker and Swarm restart an unhealthy container, and a restart cannot
# fix a Redis outage. Readiness (/health/ready) is for the load balancer.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8000) + '/health/live', { signal: AbortSignal.timeout(2000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Node runs as PID 1 itself (no npm/pnpm wrapper), so SIGTERM reaches server.ts, which drains and exits.
# The preload starts OpenTelemetry when an OTEL_* destination is set, and does nothing otherwise.
CMD ["node", "--enable-source-maps", "--import", "./dist/instrumentation.js", "dist/server.js"]
