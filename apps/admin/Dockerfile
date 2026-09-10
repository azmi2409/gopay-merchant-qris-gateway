FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.23.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin/package.json apps/admin/package.json
RUN pnpm install --frozen-lockfile
COPY apps/admin apps/admin
RUN pnpm --filter @gopay/admin build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV ADMIN_PORT=3100
RUN corepack enable && corepack prepare pnpm@11.23.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin/package.json apps/admin/package.json
RUN pnpm install --prod --frozen-lockfile
COPY --from=builder /app/apps/admin/dist ./apps/admin/dist
COPY apps/admin/public ./apps/admin/public
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3100/admin/healthz || exit 1
CMD ["node", "apps/admin/dist/server.js"]
