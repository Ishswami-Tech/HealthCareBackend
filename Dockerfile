# Build stage
FROM node:20-slim AS builder

# Label the builder stage
LABEL stage=builder
LABEL app.component=backend
LABEL app.stage=build

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install --legacy-peer-deps --no-audit --no-progress

# Copy the rest of the application
COPY . .

# Generate Prisma client
RUN npx prisma generate --schema=./src/shared/database/prisma/schema.prisma

# Build the application
RUN npm run build

# Ensure schema is copied to the dist folder
RUN mkdir -p /app/dist/shared/database/prisma
RUN cp -r /app/src/shared/database/prisma/schema.prisma /app/dist/shared/database/prisma/

# Production stage
FROM node:20-slim AS production

# Label the production image
LABEL app.component=backend
LABEL app.stage=production
LABEL com.docker.compose.service=api

WORKDIR /app

# Install production dependencies
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev --legacy-peer-deps --no-audit --no-progress && \
    npm cache clean --force

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/src/shared/database/prisma/schema.prisma ./src/shared/database/prisma/schema.prisma
COPY --from=builder /app/dist/shared/database/prisma/schema.prisma ./dist/shared/database/prisma/schema.prisma

# Copy environment files
COPY .env.production .env.development ./

# Environment-specific configurations
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}
ENV PRISMA_SCHEMA_PATH=/app/src/shared/database/prisma/schema.prisma

# Production-specific environment variables
ENV NODE_OPTIONS="--max-old-space-size=1536 --max-http-header-size=16384 --expose-gc"
ENV ENABLE_GC=true
ENV GC_INTERVAL=21600

# Expose port
EXPOSE 8088

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -q --spider http://localhost:8088/health || exit 1

# Start script with environment handling
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main"]

# Development stage
FROM node:20-alpine AS development

# Label the development image
LABEL app.component=backend
LABEL app.stage=development

# Install development tools
RUN apk add --no-cache \
    postgresql-client \
    redis \
    busybox-extras \
    python3 \
    make \
    g++ \
    wget \
    curl \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --legacy-peer-deps --no-audit --no-progress && \
    npm install -g nodemon && \
    npm cache clean --force

# Copy application files
COPY . .

# Environment setup
ENV NODE_ENV=development
ENV PRISMA_SCHEMA_PATH=/app/src/shared/database/prisma/schema.prisma

# Generate Prisma client
RUN npx prisma generate --schema="$PRISMA_SCHEMA_PATH"

# Create necessary directories
RUN mkdir -p /app/dist/shared/database/prisma /app/logs && \
    chmod -R 777 /app/dist /app/logs

# Expose ports
EXPOSE 8088 5555

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8088/health || exit 1

# Development startup command
CMD ["npm", "run", "start:dev"] 