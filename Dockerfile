# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy the rest of the application
COPY . .

# Generate Prisma Client for both schemas
RUN npx prisma generate --schema=src/shared/database/prisma/schema.prisma && \
    npx prisma generate --schema=src/shared/database/prisma/tenant.schema.prisma

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install necessary tools
RUN apk add --no-cache postgresql-client redis busybox-extras python3 make g++

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --only=production --legacy-peer-deps

# Copy the entire src directory to preserve structure
COPY src ./src
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Set environment variables
ENV NODE_ENV=production
ENV PRISMA_SCHEMA_PATH=/app/src/shared/database/prisma/schema.prisma
ENV DATABASE_URL="postgresql://postgres:postgres@postgres:5432/userdb?schema=public"

# Verify schema files are present
RUN ls -la /app/src/shared/database/prisma/ || exit 1

# Expose ports
EXPOSE 8088 5555

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8088/health || exit 1

# Start script
CMD ["sh", "-c", "\
    echo 'Waiting for PostgreSQL...' && \
    while ! nc -z postgres 5432; do sleep 1; done && \
    echo 'Running migrations...' && \
    npx prisma migrate deploy --schema=/app/src/shared/database/prisma/schema.prisma && \
    echo 'Starting application...' && \
    node dist/main"]

# Development stage
FROM node:20-alpine AS development

# Install necessary tools
RUN apk add --no-cache postgresql-client redis busybox-extras python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies)
RUN npm install --legacy-peer-deps
RUN npm install -g nodemon

# Copy the rest of the application
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