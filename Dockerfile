# Build stage
FROM node:20-slim AS builder

# Label the builder stage for better cache management
LABEL stage=builder
LABEL app.component=backend
LABEL app.stage=build

# Install build dependencies for bcrypt and other native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json ./

# Install dependencies with explicit handling for bcrypt
RUN npm install --legacy-peer-deps --no-audit --no-progress

# Copy the rest of the application
COPY . .

# Generate Prisma client before building
RUN npx prisma generate --schema=./src/shared/database/prisma/schema.prisma

# Build the application
RUN npm run build

# Ensure schema is copied to the dist folder
RUN mkdir -p /app/dist/shared/database/prisma
RUN cp -r /app/src/shared/database/prisma/schema.prisma /app/dist/shared/database/prisma/

# Production stage with optimizations
FROM node:20-slim AS production

# Label the production image for identification
LABEL app.component=backend
LABEL app.stage=production
LABEL com.docker.compose.service=api

WORKDIR /app

# Install only production dependencies for native modules
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json files for production install
COPY package*.json ./

# Install only production dependencies to reduce image size
RUN npm ci --omit=dev --legacy-peer-deps --no-audit --no-progress && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy Prisma schema to both src and dist directories to ensure availability
COPY --from=builder /app/src/shared/database/prisma/schema.prisma ./src/shared/database/prisma/schema.prisma
COPY --from=builder /app/dist/shared/database/prisma/schema.prisma ./dist/shared/database/prisma/schema.prisma

# Set environment variables
ENV NODE_ENV=production
ENV PRISMA_SCHEMA_PATH=/app/src/shared/database/prisma/schema.prisma
ENV REDIS_COMMANDER_URL=/redis-ui
ENV SOCKET_URL=/socket.io
ENV REDIS_UI_URL=/redis-ui
ENV LOGGER_URL=/logger
# Optimize Node.js for production
ENV NODE_OPTIONS="--max-old-space-size=1536 --max-http-header-size=16384 --expose-gc"
# Enable garbage collection to help with memory management
ENV ENABLE_GC=true
ENV GC_INTERVAL=21600

# Expose ports
EXPOSE 8088

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -q --spider http://localhost:8088/health || exit 1

# Start the application with improved startup sequence
CMD ["sh", "-c", "npx prisma generate --schema=\"$PRISMA_SCHEMA_PATH\" && node dist/main"]

# Development stage
FROM node:20-alpine AS development

# Label the development image
LABEL app.component=backend
LABEL app.stage=development

# Install necessary tools in a single layer
RUN apk add --no-cache postgresql-client redis busybox-extras python3 make g++ && \
    rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --legacy-peer-deps --no-audit --no-progress && \
    npm install -g nodemon && \
    npm cache clean --force

# Copy application files
COPY . .

# Set Prisma schema path and generate client
ENV PRISMA_SCHEMA_PATH=/app/src/shared/database/prisma/schema.prisma
RUN npx prisma generate --schema=\"$PRISMA_SCHEMA_PATH\"

# Ensure dist directory exists and contains schema
RUN mkdir -p /app/dist/shared/database/prisma
RUN cp -r /app/src/shared/database/prisma/schema.prisma /app/dist/shared/database/prisma/

# Make the script executable
RUN chmod +x /app/src/shared/database/prisma/wait-for-postgres.sh

# Set proper permissions for hot reloading
RUN chmod -R 777 /app

# Expose ports
EXPOSE 8088 5555

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8088/health || exit 1

# Use nodemon in development with migrations
CMD ["sh", "-c", "npx prisma migrate deploy --schema=\"$PRISMA_SCHEMA_PATH\" && npm run start:dev"] 