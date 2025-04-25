# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy the rest of the application
COPY . .

# Set Prisma schema path and generate client
ENV PRISMA_SCHEMA_PATH=/app/src/shared/database/prisma/schema.prisma
RUN npx prisma generate --schema=$PRISMA_SCHEMA_PATH

# Production stage
FROM node:20-alpine AS production

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

# Copy Prisma schema and migrations
COPY src/shared/database/prisma ./prisma

# Set environment variables
ENV NODE_ENV=production
ENV PRISMA_SCHEMA_PATH=/app/prisma/schema.prisma

# Expose ports
EXPOSE 8088 5555

# Start the application
CMD ["node", "dist/main"]

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

# Use nodemon in development
CMD ["nodemon", "--watch", "src", "--ext", "ts", "--exec", "npm run start:dev"] 