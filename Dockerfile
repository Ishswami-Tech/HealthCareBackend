# Build stage
FROM node:20-alpine AS builder

# Add build argument for Prisma schema path
ARG PRISMA_SCHEMA_PATH=/app/src/shared/database/prisma/schema.prisma

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy the rest of the application
COPY . .

# Create prisma directory and ensure schema exists
RUN mkdir -p /app/src/shared/database/prisma
RUN touch $PRISMA_SCHEMA_PATH

# Set Prisma schema path and generate client
ENV PRISMA_SCHEMA_PATH=$PRISMA_SCHEMA_PATH
RUN npx prisma generate --schema=$PRISMA_SCHEMA_PATH

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Add build argument for Prisma schema path
ARG PRISMA_SCHEMA_PATH=/app/src/shared/database/prisma/schema.prisma

# Install necessary tools
RUN apk add --no-cache postgresql-client redis busybox-extras python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm install --only=production --legacy-peer-deps

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/@nestjs ./node_modules/@nestjs
COPY --from=builder /app/node_modules/class-validator ./node_modules/class-validator
COPY --from=builder /app/node_modules/class-transformer ./node_modules/class-transformer
COPY --from=builder /app/node_modules/reflect-metadata ./node_modules/reflect-metadata
COPY --from=builder /app/node_modules/rxjs ./node_modules/rxjs
COPY --from=builder /app/node_modules/tslib ./node_modules/tslib
COPY --from=builder /app/node_modules/zone.js ./node_modules/zone.js

# Create prisma directory and copy schema
RUN mkdir -p /app/src/shared/database/prisma
COPY src/shared/database/prisma/schema.prisma /app/src/shared/database/prisma/
COPY src/shared/database/prisma/tenant.schema.prisma /app/src/shared/database/prisma/
COPY src/shared/database/prisma/migrations /app/src/shared/database/prisma/migrations

# Set environment variables
ENV NODE_ENV=production
ENV PRISMA_SCHEMA_PATH=$PRISMA_SCHEMA_PATH

# Expose ports
EXPOSE 8088 5555

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8088/health || exit 1

# Start the application with migrations
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]

# Development stage
FROM node:20-alpine AS development

# Add build argument for Prisma schema path
ARG PRISMA_SCHEMA_PATH=/app/src/shared/database/prisma/schema.prisma

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

# Create prisma directory and ensure schema exists
RUN mkdir -p /app/src/shared/database/prisma
RUN touch $PRISMA_SCHEMA_PATH

# Set Prisma schema path and generate client
ENV PRISMA_SCHEMA_PATH=$PRISMA_SCHEMA_PATH
RUN npx prisma generate --schema=$PRISMA_SCHEMA_PATH

# Make the script executable
RUN chmod +x /app/src/shared/database/prisma/wait-for-postgres.sh

# Expose ports
EXPOSE 8088 5555

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8088/health || exit 1

# Use nodemon in development with migrations
CMD ["sh", "-c", "npx prisma migrate deploy && nodemon --watch src --ext ts --exec npm run start:dev"] 