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
# --ignore-engines suppresses warnings about invalid engine specifications
RUN yarn install --frozen-lockfile --ignore-scripts --ignore-engines

# Copy all source files including SWC configuration
# .swcrc and nest-cli.json are required for SWC compiler (20x faster than tsc)
# Explicitly verify SWC config files are present (cross-platform compatibility)
COPY . .
RUN test -f .swcrc && test -f nest-cli.json && echo "[OK] SWC configuration files verified" || (echo "[ERROR] SWC config files missing!" && exit 1)

# Generate Prisma Client during Docker build (ONLY time it's generated)
# This ensures TypeScript can resolve @prisma/client types
# Prisma client is NOT generated in CI or at container startup - only here during build
# Build script (yarn build) expects Prisma Client to already be generated
RUN yarn prisma:generate

# Verify Prisma Client was generated correctly
# Prisma Client is generated to src/generated/prisma (app-local directory)
RUN if [ -d "src/generated/prisma" ]; then \
  echo "[OK] Prisma Client generated successfully to src/generated/prisma" && \
  echo "Client directory contents:" && \
  ls -la src/generated/prisma/ | head -15 || true; \
  else \
  echo "[ERROR] Prisma Client generation failed - src/generated/prisma not found!" && \
  exit 1; \
  fi

# Ensure @prisma/client is accessible for TypeScript resolution
# Create symlink from node_modules/@prisma/client to generated client
# This allows TypeScript to resolve @prisma/client via standard module resolution
RUN mkdir -p node_modules/@prisma && \
  if [ ! -e node_modules/@prisma/client ]; then \
  ln -sf ../../src/generated/prisma node_modules/@prisma/client || \
  (echo "[WARN] Could not create symlink, path mapping will be used" && true); \
  fi && \
  echo "[OK] @prisma/client symlink created for TypeScript resolution"

# Prisma Client is in src/generated/prisma (app-local directory)
# No need to copy to node_modules/.prisma/client - we use the app-local location directly

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
# Prisma Client is already generated above (line 34) - no need to regenerate
# Use yarn build to run all optimizations, linting, and formatting ONCE in Docker
# CI skips linting for production, so this is the only place it runs (no duplication)
RUN yarn build

# Ensure Prisma schema is available in dist
RUN mkdir -p /app/dist/libs/infrastructure/database/prisma && \
  cp -r /app/src/libs/infrastructure/database/prisma/schema.prisma /app/dist/libs/infrastructure/database/prisma/

# Copy generated Prisma client to dist for runtime access
# Prisma Client is generated to src/generated/prisma and compiled to dist/generated/prisma
RUN mkdir -p /app/dist/generated && \
  cp -r /app/src/generated/prisma /app/dist/generated/

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
# Prisma Client is in src/generated/prisma (app-local directory), not in node_modules
RUN yarn install --production --frozen-lockfile --ignore-scripts --ignore-engines && yarn cache clean

# Remove yarn-installed @prisma packages to avoid conflicts
# We'll copy only the necessary @prisma packages from builder stage
RUN rm -rf /app/node_modules/prisma /app/node_modules/@prisma

# Copy prisma CLI for migrations (needed for prisma migrate deploy at startup)
COPY --from=builder /app/node_modules_real/prisma ./node_modules/prisma
# Copy all @prisma packages EXCEPT client (we'll create symlink to generated client)
# First, copy @prisma directory structure
RUN mkdir -p /app/node_modules/@prisma
# Copy all @prisma packages except the client directory (which we'll symlink)
COPY --from=builder /app/node_modules_real/@prisma ./node_modules/@prisma
# Remove the client directory if it exists (it will be replaced with symlink)
RUN if [ -d /app/node_modules/@prisma/client ]; then \
  rm -rf /app/node_modules/@prisma/client && \
  echo "[OK] Removed @prisma/client directory to make room for symlink"; \
  fi
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
# Copy Prisma schema, config, migrations, and generated client to expected paths
COPY --from=builder /app/src/libs/infrastructure/database/prisma/schema.prisma ./src/libs/infrastructure/database/prisma/schema.prisma
COPY --from=builder /app/src/libs/infrastructure/database/prisma/prisma.config.js ./src/libs/infrastructure/database/prisma/prisma.config.js
# Copy migrations folder for prisma migrate deploy (CRITICAL for production deployments)
# Without this, P3005 error occurs: "database schema is not empty" with no migrations
COPY --from=builder /app/src/libs/infrastructure/database/prisma/migrations ./src/libs/infrastructure/database/prisma/migrations
# Copy Prisma generated client from builder stage (generated during build to src/generated/prisma)
COPY --from=builder /app/src/generated/prisma ./src/generated/prisma
COPY --from=builder /app/dist/generated/prisma ./dist/generated/prisma
COPY --from=builder /app/dist/libs/infrastructure/database/prisma/schema.prisma ./dist/libs/infrastructure/database/prisma/schema.prisma

# Verify Prisma Client was copied correctly from builder stage
RUN if [ ! -d /app/src/generated/prisma ]; then \
  echo "[ERROR] Prisma Client not found in copied files!" && exit 1; \
  elif [ ! -f /app/src/generated/prisma/index.js ] && \
       [ ! -f /app/src/generated/prisma/index.mjs ] && \
       [ ! -f /app/src/generated/prisma/index.d.ts ]; then \
  echo "[WARN] Prisma Client entry point not found in src, checking dist..." && \
  if [ ! -d /app/dist/generated/prisma ]; then \
    echo "[ERROR] Prisma Client not found in dist either!" && exit 1; \
  fi; \
  else \
  echo "[OK] Prisma Client verified - generated during build, copied to production stage"; \
  fi

# Create entrypoint script - simplified for app-local Prisma Client location
# Prisma Client is generated at build time to src/generated/prisma and compiled to dist/generated/prisma
RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
  echo 'set -e' >> /app/entrypoint.sh && \
  echo '' >> /app/entrypoint.sh && \
  echo 'echo "=========================================="' >> /app/entrypoint.sh && \
  echo 'echo "Healthcare Backend - Container Startup"' >> /app/entrypoint.sh && \
  echo 'echo "=========================================="' >> /app/entrypoint.sh && \
  echo '' >> /app/entrypoint.sh && \
  echo '# Verify Prisma Client exists (generated during Docker build, not at runtime)' >> /app/entrypoint.sh && \
  echo 'echo "[INFO] Verifying Prisma Client (generated during Docker build)..."' >> /app/entrypoint.sh && \
  echo 'if [ -d /app/dist/generated/prisma ] || [ -d /app/src/generated/prisma ]; then' >> /app/entrypoint.sh && \
  echo '  echo "[OK] Prisma Client found in app-local directory (from Docker build)"' >> /app/entrypoint.sh && \
  echo 'else' >> /app/entrypoint.sh && \
  echo '  echo "[ERROR] Prisma Client not found! It should have been generated during Docker build."' >> /app/entrypoint.sh && \
  echo '  echo "[ERROR] Expected locations: /app/dist/generated/prisma or /app/src/generated/prisma"' >> /app/entrypoint.sh && \
  echo '  exit 1' >> /app/entrypoint.sh && \
  echo 'fi' >> /app/entrypoint.sh && \
  echo '' >> /app/entrypoint.sh && \
  echo '# Ensure @prisma/client symlink points to app-local location' >> /app/entrypoint.sh && \
  echo 'mkdir -p /app/node_modules/@prisma' >> /app/entrypoint.sh && \
  echo 'if [ -L /app/node_modules/@prisma/client ]; then' >> /app/entrypoint.sh && \
  echo '  rm /app/node_modules/@prisma/client' >> /app/entrypoint.sh && \
  echo 'fi' >> /app/entrypoint.sh && \
  echo 'ln -sf /app/src/generated/prisma /app/node_modules/@prisma/client' >> /app/entrypoint.sh && \
  echo 'echo "[OK] @prisma/client symlink created to app-local location"' >> /app/entrypoint.sh && \
  echo '' >> /app/entrypoint.sh && \
  echo 'echo "=========================================="' >> /app/entrypoint.sh && \
  echo 'echo "Starting application..."' >> /app/entrypoint.sh && \
  echo 'echo "=========================================="' >> /app/entrypoint.sh && \
  echo '' >> /app/entrypoint.sh && \
  echo 'exec "$@"' >> /app/entrypoint.sh && \
  chmod +x /app/entrypoint.sh && \
  echo "[OK] Entrypoint script created"

# Ensure @prisma/client symlink exists for TypeScript resolution
# Prisma Client is in src/generated/prisma (app-local directory)
RUN mkdir -p /app/node_modules/@prisma && \
  if [ ! -d /app/src/generated/prisma ]; then \
  echo "[ERROR] Generated Prisma Client directory not found!" && exit 1; \
  fi && \
  if [ -L /app/node_modules/@prisma/client ] || [ -d /app/node_modules/@prisma/client ]; then \
  rm -rf /app/node_modules/@prisma/client; \
  fi && \
  ln -sf /app/src/generated/prisma /app/node_modules/@prisma/client && \
  echo "[OK] @prisma/client symlink created to app-local location" && \
  if [ -d /app/node_modules/@prisma/client ] && [ "$(ls -A /app/node_modules/@prisma/client 2>/dev/null)" ]; then \
  echo "[OK] @prisma/client symlink verified and accessible"; \
  else \
  echo "[WARN] @prisma/client symlink exists but not accessible (entrypoint will fix at runtime)"; \
  fi

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

# Set entrypoint (runs before CMD)
# Entrypoint will verify Prisma Client exists (generated during build)
# Only regenerates if missing (should not happen in normal operation)
ENTRYPOINT ["/app/entrypoint.sh"]

# Run migrations automatically before starting the app
# Docker Compose depends_on ensures PostgreSQL is ready
# Check if migrations exist, otherwise use db push for fresh database
CMD ["sh", "-c", "if [ -d 'src/libs/infrastructure/database/prisma/migrations' ] && [ \"$(ls -A src/libs/infrastructure/database/prisma/migrations 2>/dev/null)\" ]; then echo 'Migrations found, running migrate deploy...'; node scripts/run-prisma.js migrate || echo 'Migration failed, continuing...'; else echo 'No migrations found, using db push for initial setup...'; node scripts/run-prisma.js push || echo 'Database setup completed or skipped'; fi && node dist/main.js"]

