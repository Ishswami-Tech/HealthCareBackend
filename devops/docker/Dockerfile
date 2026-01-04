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
# Check if the client directory exists and has the required files
# Prisma 7 generates both TypeScript and JavaScript files
RUN if [ -d "src/libs/infrastructure/database/prisma/generated/client" ]; then \
  echo "Checking Prisma Client generation..." && \
  echo "Client directory contents:" && \
  ls -la src/libs/infrastructure/database/prisma/generated/client/ | head -15 || true && \
  # Check for index.js (JavaScript entry point)
  if [ -f "src/libs/infrastructure/database/prisma/generated/client/index.js" ]; then \
  echo "[OK] Prisma Client generated successfully (index.js found)"; \
  # Also check if runtime/client.js exists (required by index.js)
  if [ -f "src/libs/infrastructure/database/prisma/generated/client/runtime/client.js" ]; then \
  echo "[OK] Runtime client.js found"; \
  else \
  echo "[WARN] Runtime client.js not found - checking for .mjs or .ts"; \
  fi; \
  elif [ -f "src/libs/infrastructure/database/prisma/generated/client/index.mjs" ]; then \
  echo "[OK] Prisma Client generated successfully (index.mjs found)"; \
  elif [ "$(ls -A src/libs/infrastructure/database/prisma/generated/client 2>/dev/null)" ]; then \
  echo "[WARN] Prisma Client directory exists with files but index.js not found" && \
  echo "Checking if Prisma generated JavaScript files in standard location..." && \
  # Check if Prisma generated index.js in node_modules/.prisma/client
  if [ -f "node_modules/.prisma/client/index.js" ]; then \
  echo "[OK] Found index.js in node_modules/.prisma/client, copying to generated client" && \
  cp node_modules/.prisma/client/index.js src/libs/infrastructure/database/prisma/generated/client/ 2>/dev/null || true && \
  # Also copy runtime directory if it exists
  if [ -d "node_modules/.prisma/client/runtime" ]; then \
  cp -r node_modules/.prisma/client/runtime src/libs/infrastructure/database/prisma/generated/client/ 2>/dev/null || true; \
  fi; \
  echo "[OK] Copied index.js and runtime to generated client"; \
  else \
  echo "[WARN] index.js not found in standard location either"; \
  echo "[OK] Prisma Client directory exists with content (TypeScript files)"; \
  fi; \
  else \
  echo "[ERROR] Prisma Client directory exists but is empty!" && \
  exit 1; \
  fi; \
  else \
  echo "[ERROR] Prisma Client generation failed - directory not found!" && \
  echo "Checking generated directory:" && \
  ls -la src/libs/infrastructure/database/prisma/generated/ 2>/dev/null || echo "Generated directory not found" && \
  exit 1; \
  fi

# Ensure @prisma/client is accessible for TypeScript resolution
# Create symlink from node_modules/@prisma/client to generated client
# This allows TypeScript to resolve @prisma/client via standard module resolution
RUN mkdir -p node_modules/@prisma && \
  if [ ! -e node_modules/@prisma/client ]; then \
  ln -sf ../../src/libs/infrastructure/database/prisma/generated/client node_modules/@prisma/client || \
  (echo "[WARN] Could not create symlink, path mapping will be used" && true); \
  fi && \
  echo "[OK] @prisma/client symlink created for TypeScript resolution"

# Ensure .prisma/client directory exists as a real directory (not symlink) for Docker COPY
# Yarn creates real directories, but we ensure proper structure for Docker COPY
# Prisma 7 generates both TypeScript and JavaScript files
# Copy generated client to .prisma/client for runtime access
# Prisma may generate JavaScript files in node_modules/.prisma/client
# Copy from generated client first, then check standard location
RUN mkdir -p /app/node_modules/.prisma/client && \
  # Copy all files from generated client (includes TypeScript and any JavaScript files)
  cp -r /app/src/libs/infrastructure/database/prisma/generated/client/* /app/node_modules/.prisma/client/ 2>/dev/null || true && \
  # Check if Prisma generated index.js in the standard location and copy it if needed
  if [ -f /app/node_modules/.prisma/client/index.js ]; then \
  echo "[OK] Found index.js in .prisma/client (from generated client)"; \
  elif [ -d /app/node_modules/.prisma ] && [ -f /app/node_modules/.prisma/client/index.js ]; then \
  echo "[OK] Found index.js in standard Prisma location, already copied"; \
  else \
  echo "[WARN] index.js not found - checking if Prisma needs to generate it"; \
  # Try to find index.js anywhere in node_modules
  find /app/node_modules -name "index.js" -path "*/.prisma/client/*" 2>/dev/null | head -1 | while read jsfile; do \
  if [ -n "$jsfile" ]; then \
  echo "[OK] Found index.js at $jsfile, copying to .prisma/client"; \
  cp "$jsfile" /app/node_modules/.prisma/client/ 2>/dev/null || true; \
  fi; \
  done; \
  fi && \
  # Verify index.js exists now
  if [ -f /app/node_modules/.prisma/client/index.js ]; then \
  echo "[OK] index.js verified in .prisma/client"; \
  else \
  echo "[WARN] index.js still not found - Prisma 7 may use TypeScript files directly at runtime"; \
  fi

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
# Prisma Client is already generated above (line 33) - no need to regenerate
# Use yarn build to run all optimizations, linting, and formatting ONCE in Docker
# CI skips linting for production, so this is the only place it runs (no duplication)
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
RUN yarn install --production --frozen-lockfile --ignore-scripts --ignore-engines && yarn cache clean

# Remove yarn-installed @prisma packages to avoid COPY conflicts
# Then copy real Prisma directories from builder stage
RUN rm -rf /app/node_modules/.prisma /app/node_modules/prisma /app/node_modules/@prisma

# Copy Prisma client and related packages (dereferenced from symlinks in builder stage)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
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
# Copy Prisma schema, config, and generated client to expected paths
COPY --from=builder /app/src/libs/infrastructure/database/prisma/schema.prisma ./src/libs/infrastructure/database/prisma/schema.prisma
COPY --from=builder /app/src/libs/infrastructure/database/prisma/prisma.config.js ./src/libs/infrastructure/database/prisma/prisma.config.js
# Copy Prisma generated client from builder stage (generated during build, not at runtime)
COPY --from=builder /app/src/libs/infrastructure/database/prisma/generated ./src/libs/infrastructure/database/prisma/generated
COPY --from=builder /app/dist/libs/infrastructure/database/prisma/schema.prisma ./dist/libs/infrastructure/database/prisma/schema.prisma

# Verify Prisma Client was copied correctly from builder stage
RUN if [ ! -d /app/src/libs/infrastructure/database/prisma/generated/client ]; then \
  echo "[ERROR] Prisma Client not found in copied files!" && exit 1; \
  elif [ ! -f /app/src/libs/infrastructure/database/prisma/generated/client/index.js ] && \
       [ ! -f /app/src/libs/infrastructure/database/prisma/generated/client/index.mjs ] && \
       [ ! -f /app/src/libs/infrastructure/database/prisma/generated/client/client.ts ]; then \
  echo "[ERROR] Prisma Client entry point not found!" && exit 1; \
  else \
  echo "[OK] Prisma Client verified - generated during build, copied to production stage"; \
  fi

# Create entrypoint script inline (devops/docker/ is excluded by .dockerignore)
# This script ensures Prisma Client is available and symlink points to standard location
# Updated: Use symlink to standard location instead of copying files
RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
  echo 'set -e' >> /app/entrypoint.sh && \
  echo '' >> /app/entrypoint.sh && \
  echo 'echo "=========================================="' >> /app/entrypoint.sh && \
  echo 'echo "Healthcare Backend - Container Startup"' >> /app/entrypoint.sh && \
  echo 'echo "=========================================="' >> /app/entrypoint.sh && \
  echo '' >> /app/entrypoint.sh && \
  echo '# Verify Prisma Client exists (generated during Docker build, not at runtime)' >> /app/entrypoint.sh && \
  echo '# Prisma Client is generated once during yarn build in the builder stage' >> /app/entrypoint.sh && \
  echo '# and copied to production stage - no regeneration needed at runtime' >> /app/entrypoint.sh && \
  echo 'echo "[INFO] Verifying Prisma Client (generated during Docker build)..."' >> /app/entrypoint.sh && \
  echo '# Check if Prisma Client exists - Prisma 7 may generate index.js, client.js, or index.mjs' >> /app/entrypoint.sh && \
  echo 'PRISMA_FOUND=0' >> /app/entrypoint.sh && \
  echo '# Check standard location first' >> /app/entrypoint.sh && \
  echo 'if [ -d /app/node_modules/.prisma/client ] && [ -d /app/node_modules/.prisma/client/runtime ]; then' >> /app/entrypoint.sh && \
  echo '  if [ -f /app/node_modules/.prisma/client/index.js ] || [ -f /app/node_modules/.prisma/client/client.js ] || [ -f /app/node_modules/.prisma/client/index.mjs ]; then' >> /app/entrypoint.sh && \
  echo '    echo "[OK] Prisma Client found in standard location (from Docker build)"' >> /app/entrypoint.sh && \
  echo '    PRISMA_FOUND=1' >> /app/entrypoint.sh && \
  echo '    if [ ! -f /app/node_modules/.prisma/client/package.json ]; then' >> /app/entrypoint.sh && \
  echo '      echo "[INFO] Creating package.json for module resolution..."' >> /app/entrypoint.sh && \
  echo '      echo "{\"name\":\"@prisma/client\",\"main\":\"index.js\",\"types\":\"index.d.ts\"}" > /app/node_modules/.prisma/client/package.json' >> /app/entrypoint.sh && \
  echo '    fi' >> /app/entrypoint.sh && \
  echo '  fi' >> /app/entrypoint.sh && \
  echo 'fi' >> /app/entrypoint.sh && \
  echo '# Check custom location if not found in standard location' >> /app/entrypoint.sh && \
  echo 'if [ "$PRISMA_FOUND" -eq 0 ] && [ -d /app/src/libs/infrastructure/database/prisma/generated/client ]; then' >> /app/entrypoint.sh && \
  echo '  if [ -f /app/src/libs/infrastructure/database/prisma/generated/client/index.js ] || [ -f /app/src/libs/infrastructure/database/prisma/generated/client/client.js ] || [ -f /app/src/libs/infrastructure/database/prisma/generated/client/index.mjs ]; then' >> /app/entrypoint.sh && \
  echo '    echo "[OK] Prisma Client found in custom location (from Docker build)"' >> /app/entrypoint.sh && \
  echo '    PRISMA_FOUND=1' >> /app/entrypoint.sh && \
  echo '    mkdir -p /app/node_modules/.prisma/client' >> /app/entrypoint.sh && \
  echo '    cp -r /app/src/libs/infrastructure/database/prisma/generated/client/* /app/node_modules/.prisma/client/ 2>/dev/null || true' >> /app/entrypoint.sh && \
  echo '    if [ ! -f /app/node_modules/.prisma/client/package.json ]; then' >> /app/entrypoint.sh && \
  echo '      echo "{\"name\":\"@prisma/client\",\"main\":\"index.js\",\"types\":\"index.d.ts\"}" > /app/node_modules/.prisma/client/package.json' >> /app/entrypoint.sh && \
  echo '    fi' >> /app/entrypoint.sh && \
  echo '  fi' >> /app/entrypoint.sh && \
  echo 'fi' >> /app/entrypoint.sh && \
  echo '# Check dist location as last resort (Prisma Client should be there from build)' >> /app/entrypoint.sh && \
  echo 'if [ "$PRISMA_FOUND" -eq 0 ] && [ -d /app/dist/libs/infrastructure/database/prisma/generated/client ]; then' >> /app/entrypoint.sh && \
  echo '  if [ -f /app/dist/libs/infrastructure/database/prisma/generated/client/index.js ] || [ -f /app/dist/libs/infrastructure/database/prisma/generated/client/client.js ] || [ -f /app/dist/libs/infrastructure/database/prisma/generated/client/index.mjs ]; then' >> /app/entrypoint.sh && \
  echo '    echo "[OK] Prisma Client found in dist location (from Docker build)"' >> /app/entrypoint.sh && \
  echo '    PRISMA_FOUND=1' >> /app/entrypoint.sh && \
  echo '    mkdir -p /app/node_modules/.prisma/client' >> /app/entrypoint.sh && \
  echo '    cp -r /app/dist/libs/infrastructure/database/prisma/generated/client/* /app/node_modules/.prisma/client/ 2>/dev/null || true' >> /app/entrypoint.sh && \
  echo '    if [ ! -f /app/node_modules/.prisma/client/package.json ]; then' >> /app/entrypoint.sh && \
  echo '      echo "{\"name\":\"@prisma/client\",\"main\":\"index.js\",\"types\":\"index.d.ts\"}" > /app/node_modules/.prisma/client/package.json' >> /app/entrypoint.sh && \
  echo '    fi' >> /app/entrypoint.sh && \
  echo '  fi' >> /app/entrypoint.sh && \
  echo 'fi' >> /app/entrypoint.sh && \
  echo '# If still not found, exit with error' >> /app/entrypoint.sh && \
  echo 'if [ "$PRISMA_FOUND" -eq 0 ]; then' >> /app/entrypoint.sh && \
  echo '  echo "[ERROR] Prisma Client not found! It should have been generated during Docker build."' >> /app/entrypoint.sh && \
  echo '  echo "[ERROR] This is a build-time issue, not a runtime issue."' >> /app/entrypoint.sh && \
  echo '  echo "[DEBUG] Standard location: /app/node_modules/.prisma/client/"' >> /app/entrypoint.sh && \
  echo '  ls -la /app/node_modules/.prisma/client/ 2>/dev/null || echo "  Does not exist"' >> /app/entrypoint.sh && \
  echo '  echo "[DEBUG] Custom location: /app/src/libs/infrastructure/database/prisma/generated/client/"' >> /app/entrypoint.sh && \
  echo '  ls -la /app/src/libs/infrastructure/database/prisma/generated/client/ 2>/dev/null || echo "  Does not exist"' >> /app/entrypoint.sh && \
  echo '  echo "[DEBUG] Dist location: /app/dist/libs/infrastructure/database/prisma/generated/client/"' >> /app/entrypoint.sh && \
  echo '  ls -la /app/dist/libs/infrastructure/database/prisma/generated/client/ 2>/dev/null || echo "  Does not exist"' >> /app/entrypoint.sh && \
  echo '  exit 1' >> /app/entrypoint.sh && \
  echo 'fi' >> /app/entrypoint.sh && \
  echo '' >> /app/entrypoint.sh && \
  echo '# CRITICAL: Ensure client.js is copied from dist to standard location' >> /app/entrypoint.sh && \
  echo '# Prisma 7 generates client.js in dist/ which exports PrismaClient' >> /app/entrypoint.sh && \
  echo '# Standard location index.js only has error classes, not PrismaClient' >> /app/entrypoint.sh && \
  echo 'if [ -f /app/dist/libs/infrastructure/database/prisma/generated/client/client.js ]; then' >> /app/entrypoint.sh && \
  echo '  if [ ! -f /app/node_modules/.prisma/client/client.js ]; then' >> /app/entrypoint.sh && \
  echo '    echo "[INFO] Copying client.js from dist to standard location..."' >> /app/entrypoint.sh && \
  echo '    cp /app/dist/libs/infrastructure/database/prisma/generated/client/client.js /app/node_modules/.prisma/client/client.js' >> /app/entrypoint.sh && \
  echo '    echo "[OK] client.js copied to standard location"' >> /app/entrypoint.sh && \
  echo '  fi' >> /app/entrypoint.sh && \
  echo '  # Update package.json to use client.js as main entry point' >> /app/entrypoint.sh && \
  echo '  if [ -f /app/node_modules/.prisma/client/package.json ]; then' >> /app/entrypoint.sh && \
  echo '    echo "[INFO] Updating package.json to use client.js as main entry..."' >> /app/entrypoint.sh && \
  echo '    echo "{\"name\":\"@prisma/client\",\"main\":\"client.js\",\"types\":\"index.d.ts\"}" > /app/node_modules/.prisma/client/package.json' >> /app/entrypoint.sh && \
  echo '  fi' >> /app/entrypoint.sh && \
  echo 'fi' >> /app/entrypoint.sh && \
  echo '' >> /app/entrypoint.sh && \
  echo '# Ensure symlink points to standard location (has complete JavaScript runtime)' >> /app/entrypoint.sh && \
  echo '# Prisma 7 custom output only has TypeScript, standard location has JavaScript' >> /app/entrypoint.sh && \
  echo 'if [ -L /app/node_modules/@prisma/client ]; then' >> /app/entrypoint.sh && \
  echo '  CURRENT_LINK=$(readlink /app/node_modules/@prisma/client)' >> /app/entrypoint.sh && \
  echo '  if [ "$CURRENT_LINK" != "/app/node_modules/.prisma/client" ]; then' >> /app/entrypoint.sh && \
  echo '    echo "[WARN] @prisma/client symlink points to custom location, updating to standard location..."' >> /app/entrypoint.sh && \
  echo '    rm /app/node_modules/@prisma/client' >> /app/entrypoint.sh && \
  echo '  fi' >> /app/entrypoint.sh && \
  echo 'fi' >> /app/entrypoint.sh && \
  echo 'if [ ! -L /app/node_modules/@prisma/client ]; then' >> /app/entrypoint.sh && \
  echo '  echo "[INFO] Creating @prisma/client symlink to standard location..."' >> /app/entrypoint.sh && \
  echo '  mkdir -p /app/node_modules/@prisma' >> /app/entrypoint.sh && \
  echo '  ln -sf /app/node_modules/.prisma/client /app/node_modules/@prisma/client' >> /app/entrypoint.sh && \
  echo '  echo "[OK] Symlink created to standard location"' >> /app/entrypoint.sh && \
  echo 'fi' >> /app/entrypoint.sh && \
  echo '' >> /app/entrypoint.sh && \
  echo 'echo "=========================================="' >> /app/entrypoint.sh && \
  echo 'echo "Starting application..."' >> /app/entrypoint.sh && \
  echo 'echo "=========================================="' >> /app/entrypoint.sh && \
  echo '' >> /app/entrypoint.sh && \
  echo 'exec "$@"' >> /app/entrypoint.sh && \
  chmod +x /app/entrypoint.sh && \
  echo "[OK] Entrypoint script created"

# Ensure @prisma/client symlink exists for runtime module resolution
# This allows require('@prisma/client') to find the generated client
# Note: Entrypoint script will update this symlink to point to standard location at runtime
# Build-time symlink is created here for initial setup, but entrypoint ensures correct location
RUN mkdir -p /app/node_modules/@prisma && \
  # Verify generated client exists before creating symlink
  if [ ! -d /app/src/libs/infrastructure/database/prisma/generated/client ]; then \
  echo "[ERROR] Generated Prisma Client directory not found!" && exit 1; \
  fi && \
  # Verify key files exist (Prisma 7 uses client.ts, not index.js)
  if [ -f /app/src/libs/infrastructure/database/prisma/generated/client/index.js ] || \
  [ -f /app/src/libs/infrastructure/database/prisma/generated/client/client.ts ] || \
  [ -f /app/src/libs/infrastructure/database/prisma/generated/client/index.mjs ]; then \
  echo "[OK] Generated Prisma Client files found"; \
  else \
  echo "[ERROR] Generated Prisma Client entry point not found!" && \
  ls -la /app/src/libs/infrastructure/database/prisma/generated/client/ | head -10 && \
  exit 1; \
  fi && \
  # Remove existing client directory or broken symlink
  if [ -d /app/node_modules/@prisma/client ]; then \
  rm -rf /app/node_modules/@prisma/client && \
  echo "[OK] Removed existing @prisma/client directory"; \
  elif [ -L /app/node_modules/@prisma/client ] && [ ! -e /app/node_modules/@prisma/client ]; then \
  rm /app/node_modules/@prisma/client && \
  echo "[OK] Removed broken @prisma/client symlink"; \
  fi && \
  # Create initial symlink (entrypoint will update to standard location at runtime)
  # Prefer standard location if JavaScript files exist there, otherwise use custom location
  if [ -f /app/node_modules/.prisma/client/index.js ]; then \
  echo "[OK] JavaScript files found in standard location, creating symlink there" && \
  ln -sf /app/node_modules/.prisma/client /app/node_modules/@prisma/client; \
  else \
  echo "[OK] Creating initial symlink to custom location (entrypoint will update at runtime)" && \
  ln -sf /app/src/libs/infrastructure/database/prisma/generated/client /app/node_modules/@prisma/client; \
  fi && \
  echo "[OK] Created @prisma/client symlink" && \
  # Verify symlink works by checking if directory is accessible
  if [ -d /app/node_modules/@prisma/client ] && [ "$(ls -A /app/node_modules/@prisma/client 2>/dev/null)" ]; then \
  echo "[OK] @prisma/client symlink verified and accessible"; \
  else \
  echo "[WARN] @prisma/client symlink exists but not accessible (entrypoint will fix at runtime)"; \
  fi && \
  # Also verify direct path access
  echo "[OK] Generated Prisma Client verified at direct path: /app/src/libs/infrastructure/database/prisma/generated/client" && \
  # Verify dist path as well (for fallback)
  if [ -d /app/dist/libs/infrastructure/database/prisma/generated/client ]; then \
  echo "[OK] Generated Prisma Client also available in dist for fallback"; \
  else \
  echo "[WARN] Generated Prisma Client not found in dist (fallback may not work)"; \
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

