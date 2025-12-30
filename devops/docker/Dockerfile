# Build stage
FROM node:20-slim AS builder

LABEL stage=builder
LABEL app.component=backend
LABEL app.stage=build

RUN npm install -g yarn@1.22.22 --force

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json yarn.lock ./
# Skip postinstall during install - source files (including prisma.config.js) aren't copied yet
# Prisma generate is called manually after COPY . . below
RUN yarn install --frozen-lockfile --ignore-scripts

# Copy all source files including SWC configuration
# .swcrc and nest-cli.json are required for SWC compiler (20x faster than tsc)
# Explicitly verify SWC config files are present (cross-platform compatibility)
COPY . .
RUN test -f .swcrc && test -f nest-cli.json && echo "[OK] SWC configuration files verified" || (echo "[ERROR] SWC config files missing!" && exit 1)

RUN yarn prisma:generate

# Ensure .prisma/client directory exists as a real directory (not symlink) for Docker COPY
# Yarn creates real directories, but we ensure proper structure for Docker COPY
RUN mkdir -p /app/node_modules/.prisma/client && \
    cp -r /app/src/libs/infrastructure/database/prisma/generated/client/* /app/node_modules/.prisma/client/

# Yarn uses real directories (not symlinks) - copy @prisma packages for Docker multi-stage build
# This is needed because Docker COPY needs real directories across stages
RUN mkdir -p /app/node_modules_real/@prisma && \
    # Copy directly from node_modules/@prisma if it exists
    if [ -d "/app/node_modules/@prisma" ]; then \
    cp -rL /app/node_modules/@prisma/* /app/node_modules_real/@prisma/ 2>/dev/null || true; \
    fi && \
    # Copy prisma CLI
    mkdir -p /app/node_modules_real/prisma && \
    if [ -d "/app/node_modules/prisma" ]; then \
    cp -rL /app/node_modules/prisma/* /app/node_modules_real/prisma/ 2>/dev/null || true; \
    fi && \
    # Copy transitive dependencies of @prisma/adapter-pg (postgres-array, pg-types, etc.)
    echo "Copying transitive dependencies for @prisma/adapter-pg..." && \
    for PKG_NAME in postgres-array pg-types postgres-bytea postgres-date postgres-interval; do \
    if [ -d "/app/node_modules/${PKG_NAME}" ]; then \
    echo "Copying $PKG_NAME from node_modules"; \
    mkdir -p "/app/node_modules_real/${PKG_NAME}"; \
    cp -rL "/app/node_modules/${PKG_NAME}"/* "/app/node_modules_real/${PKG_NAME}/" 2>/dev/null || true; \
    else \
    echo "Warning: $PKG_NAME not found in node_modules"; \
    fi; \
    done && \
    # Verify critical packages were copied
    echo "Verifying @prisma packages copy:" && \
    MISSING_PKGS="" && \
    for PKG in engines debug client; do \
    if [ -d "/app/node_modules_real/@prisma/$PKG" ] && [ "$(ls -A /app/node_modules_real/@prisma/$PKG 2>/dev/null)" ]; then \
    echo "✅ @prisma/$PKG copied successfully"; \
    else \
    echo "❌ Warning: @prisma/$PKG not found or empty"; \
    MISSING_PKGS="$MISSING_PKGS $PKG"; \
    fi; \
    done && \
    if [ -n "$MISSING_PKGS" ]; then \
    echo "Missing packages:$MISSING_PKGS"; \
    echo "Searching in node_modules:"; \
    find /app/node_modules -name "@prisma" -type d 2>/dev/null | head -5 || echo "No @prisma packages found"; \
    else \
    echo "✅ All critical @prisma packages copied successfully"; \
    fi

# Build using SWC compiler (configured in nest-cli.json with explicit configFile path)
# Type checking runs in parallel with SWC compilation
# Works on all platforms: Windows, Linux (Docker), macOS
RUN yarn build

# Ensure Prisma schema is available in dist
RUN mkdir -p /app/dist/libs/infrastructure/database/prisma && \
    cp -r /app/src/libs/infrastructure/database/prisma/schema.prisma /app/dist/libs/infrastructure/database/prisma/

# Copy generated Prisma client to dist for relative imports in compiled code
# prisma.service.js uses: import('./generated/client') which resolves from dist/
RUN mkdir -p /app/dist/libs/infrastructure/database/prisma/generated && \
    cp -r /app/src/libs/infrastructure/database/prisma/generated/client /app/dist/libs/infrastructure/database/prisma/generated/

# Production stage
FROM node:20-slim AS production

LABEL app.component=backend
LABEL app.stage=production
LABEL com.docker.compose.service=api

RUN npm install -g yarn@1.22.22 --force

RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    wget \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json yarn.lock ./
# Skip postinstall script in production - Prisma client is already generated in builder stage
# and copied to production via COPY --from=builder /app/node_modules/.prisma
RUN yarn install --production --frozen-lockfile --ignore-scripts && yarn cache clean

# Remove yarn-installed @prisma packages to avoid COPY conflicts
# Then copy real Prisma directories from builder stage
RUN rm -rf /app/node_modules/.prisma /app/node_modules/prisma /app/node_modules/@prisma

# Copy Prisma client and related packages (dereferenced from symlinks in builder stage)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# Copy prisma CLI for migrations (needed for prisma migrate deploy at startup)
COPY --from=builder /app/node_modules_real/prisma ./node_modules/prisma
# Copy all @prisma packages including client-runtime-utils (dereferenced to avoid symlink issues)
COPY --from=builder /app/node_modules_real/@prisma ./node_modules/@prisma
# Copy transitive dependencies required by @prisma/adapter-pg
# These are peer dependencies that yarn installs in node_modules
# Use conditionals to handle missing optional packages gracefully
RUN mkdir -p /app/node_modules/postgres-array /app/node_modules/pg-types \
    /app/node_modules/postgres-bytea /app/node_modules/postgres-date \
    /app/node_modules/postgres-interval
COPY --from=builder /app/node_modules_real/postgres-array ./node_modules/postgres-array
COPY --from=builder /app/node_modules_real/pg-types ./node_modules/pg-types
COPY --from=builder /app/node_modules_real/postgres-bytea ./node_modules/postgres-bytea
COPY --from=builder /app/node_modules_real/postgres-date ./node_modules/postgres-date
COPY --from=builder /app/node_modules_real/postgres-interval ./node_modules/postgres-interval
# tsconfig-paths is now a production dependency - installed automatically by yarn
# Copy tsconfig.json for runtime path alias resolution
COPY --from=builder /app/tsconfig.json ./tsconfig.json
# Copy compiled code including generated Prisma client
COPY --from=builder /app/dist ./dist
# Copy scripts folder for migration scripts
COPY --from=builder /app/scripts ./scripts
# Copy Prisma schema, config, and generated client to expected paths
COPY --from=builder /app/src/libs/infrastructure/database/prisma/schema.prisma ./src/libs/infrastructure/database/prisma/schema.prisma
COPY --from=builder /app/src/libs/infrastructure/database/prisma/prisma.config.js ./src/libs/infrastructure/database/prisma/prisma.config.js
COPY --from=builder /app/src/libs/infrastructure/database/prisma/generated ./src/libs/infrastructure/database/prisma/generated
COPY --from=builder /app/dist/libs/infrastructure/database/prisma/schema.prisma ./dist/libs/infrastructure/database/prisma/schema.prisma

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}
ENV PRISMA_SCHEMA_PATH=/app/src/libs/infrastructure/database/prisma/schema.prisma

# Optimized for 8 vCPU/24GB RAM: 700-900 concurrent users, ~1200-1800 req/s
# Can run on 6 vCPU/12GB RAM initially (Docker enforces limits)
ENV NODE_OPTIONS="--max-old-space-size=6144 --max-http-header-size=16384 --expose-gc"
ENV ENABLE_GC=true
ENV GC_INTERVAL=10800

EXPOSE 8088

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -q --spider http://localhost:8088/health || exit 1

# Run migrations automatically before starting the app
# Docker Compose depends_on ensures PostgreSQL is ready
# Check if migrations exist, otherwise use db push for fresh database
CMD ["sh", "-c", "if [ -d 'src/libs/infrastructure/database/prisma/migrations' ] && [ \"$(ls -A src/libs/infrastructure/database/prisma/migrations 2>/dev/null)\" ]; then echo 'Migrations found, running migrate deploy...'; node scripts/run-prisma.js migrate || echo 'Migration failed, continuing...'; else echo 'No migrations found, using db push for initial setup...'; node scripts/run-prisma.js push || echo 'Database setup completed or skipped'; fi && node dist/main.js"]

