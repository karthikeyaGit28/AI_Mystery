# syntax=docker/dockerfile:1
FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
ENV MONGOMS_DISABLE_POSTINSTALL=1

# Preserve workspace paths while caching dependency installation.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/server/package.json ./packages/server/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci --include=dev --no-audit --no-fund

COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22.23.4-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates ffmpeg fonts-dejavu-core fontconfig tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    SERVE_WEB=true \
    WEB_DIST_PATH=apps/web/dist \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe
ENV FREE_TIER_ONLY=true \
    MEDIA_PROVIDER=cloudflare \
    GEMINI_TEXT_MIN_INTERVAL_MS=15000 \
    WORKER_DRAIN_DELAY_SECONDS=60 \
    WORKER_STALLED_INTERVAL_MS=120000 \
    WORKER_CONCURRENCY=1 \
    MAX_MEDIA_BYTES=20971520

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY --from=build /app/apps/api/src ./apps/api/src
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /app/apps/worker/tsconfig.json ./apps/worker/tsconfig.json
COPY --from=build /app/apps/worker/src ./apps/worker/src
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/tsconfig.json ./packages/server/tsconfig.json
COPY --from=build /app/packages/server/src ./packages/server/src
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY --from=build /app/packages/shared/src ./packages/shared/src
COPY scripts/check-runtime.mjs scripts/check-infrastructure.ts scripts/start-combined.mjs ./scripts/
RUN mkdir -p /app/apps/worker/.artifacts && chown node:node /app/apps/worker/.artifacts

USER node
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--max-old-space-size=48", "scripts/start-combined.mjs"]
