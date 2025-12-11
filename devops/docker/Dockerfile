# Build stage
FROM node:20-slim AS builder

LABEL stage=builder
LABEL app.component=backend
LABEL app.stage=build

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy all source files including SWC configuration
# .swcrc and nest-cli.json are required for SWC compiler (20x faster than tsc)
# Explicitly verify SWC config files are present (cross-platform compatibility)
COPY . .
RUN test -f .swcrc && test -f nest-cli.json && echo "[OK] SWC configuration files verified" || (echo "[ERROR] SWC config files missing!" && exit 1)

RUN pnpm prisma:generate
# Build using SWC compiler (configured in nest-cli.json with explicit configFile path)
# Type checking runs in parallel with SWC compilation
# Works on all platforms: Windows, Linux (Docker), macOS
RUN pnpm build

# Ensure Prisma schema is available in dist
RUN mkdir -p /app/dist/libs/infrastructure/database/prisma && \
    cp -r /app/src/libs/infrastructure/database/prisma/schema.prisma /app/dist/libs/infrastructure/database/prisma/

# Production stage
FROM node:20-slim AS production

LABEL app.component=backend
LABEL app.stage=production
LABEL com.docker.compose.service=api

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/libs/infrastructure/database/prisma/schema.prisma ./src/libs/infrastructure/database/prisma/schema.prisma
COPY --from=builder /app/dist/libs/infrastructure/database/prisma/schema.prisma ./dist/libs/infrastructure/database/prisma/schema.prisma

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}
ENV PRISMA_SCHEMA_PATH=/app/src/libs/infrastructure/database/prisma/schema.prisma

ENV NODE_OPTIONS="--max-old-space-size=1536 --max-http-header-size=16384 --expose-gc"
ENV ENABLE_GC=true
ENV GC_INTERVAL=21600

EXPOSE 8088

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -q --spider http://localhost:8088/health || exit 1

CMD ["node", "dist/main.js"]

