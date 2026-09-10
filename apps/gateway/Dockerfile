# ─── Stage 1: Build ───
FROM node:24-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.23.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/gateway/package.json apps/gateway/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN pnpm install --frozen-lockfile

COPY apps/gateway apps/gateway
RUN pnpm --filter @gopay/gateway build

# ─── Stage 2: Production Runner ───
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN corepack enable && corepack prepare pnpm@11.23.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/gateway/package.json apps/gateway/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN pnpm install --prod --frozen-lockfile && pnpm store prune

COPY --from=builder /app/apps/gateway/dist ./apps/gateway/dist
COPY apps/gateway/public ./apps/gateway/public

# Persist data directory and use non-root node user
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3000
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/v1/healthz || exit 1

CMD ["node", "apps/gateway/dist/server.js"]
