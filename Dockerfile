# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and use npm ci for faster, reliable installs
COPY package*.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-progress

# Copy only necessary files for build
COPY tsconfig*.json ./
COPY src ./src

# Generate Prisma Client for both schemas
RUN npx prisma generate --schema=src/shared/database/prisma/schema.prisma && \
    npx prisma generate --schema=src/shared/database/prisma/tenant.schema.prisma

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install necessary tools in a single layer
RUN apk add --no-cache postgresql-client redis busybox-extras python3 make g++ curl && \
    rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production --legacy-peer-deps --no-audit --no-progress && \
    npm cache clean --force

# Copy only necessary files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY src/shared/database/prisma ./src/shared/database/prisma
# Copy views directory for dashboard template
COPY src/views ./dist/src/views

# Set environment variables
ENV NODE_ENV=production \
    PRISMA_SCHEMA_PATH=/app/src/shared/database/prisma/schema.prisma \
    DATABASE_URL="postgresql://postgres:postgres@postgres:5432/userdb?schema=public" \
    HOST=0.0.0.0

# Expose ports
EXPOSE 8088 5555

# Add healthcheck with increased timeout and start period
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -k --fail --max-time 10 https://localhost:8088/health || exit 1

# Start script with optimized waiting
CMD ["sh", "-c", "\
    timeout 60s sh -c 'until nc -z postgres 5432; do sleep 1; done' && \
    npx prisma migrate deploy --schema=/app/src/shared/database/prisma/schema.prisma && \
    node dist/main"]

# Development stage
FROM node:20-alpine AS development

# Install necessary tools in a single layer
RUN apk add --no-cache postgresql-client redis busybox-extras python3 make g++ && \
    rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-progress && \
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