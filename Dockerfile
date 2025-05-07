# Build stage
FROM node:20-slim AS builder

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

# Build the application
RUN npm run build

# Production stage
FROM node:20-slim

WORKDIR /app

# Install production dependencies for native modules
RUN apt-get update && apt-get install -y \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Copy built application and node_modules from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY .env.production ./.env

# Set environment variables
ENV NODE_ENV=production

# Expose port
EXPOSE 8088

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -q --spider http://localhost:8088/health || exit 1

# Start the application
CMD ["node", "dist/main"]

# Development stage
FROM node:20-alpine AS development

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
RUN npx prisma generate --schema=$PRISMA_SCHEMA_PATH

# Make the script executable
RUN chmod +x /app/src/shared/database/prisma/wait-for-postgres.sh

# Expose ports
EXPOSE 8088 5555

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8088/health || exit 1

# Use nodemon in development with migrations
CMD ["sh", "-c", "npx prisma migrate deploy --schema=/app/src/shared/database/prisma/schema.prisma && nodemon --watch src --ext ts --exec npm run start:dev"] 