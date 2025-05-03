# Build stage
FROM node:20-alpine AS builder

# Install necessary build tools
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install npm@11.3.0 globally
RUN npm install -g npm@11.3.0

# Clear npm cache and remove existing node_modules
RUN npm cache clean --force && rm -rf node_modules

# Install dependencies with exact versions
RUN npm install --legacy-peer-deps --no-audit --no-progress

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate --schema=src/shared/database/prisma/schema.prisma && \
    npx prisma generate --schema=src/shared/database/prisma/tenant.schema.prisma

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install necessary tools in a single layer
RUN apk add --no-cache postgresql-client redis busybox-extras python3 make g++ wget openssl ca-certificates && \
    rm -rf /var/cache/apk/*

WORKDIR /app

# Create SSL directories with proper permissions
RUN mkdir -p /app/ssl /etc/nginx/ssl && \
    chmod 755 /app/ssl /etc/nginx/ssl

# Install npm@11.3.0 globally
RUN npm install -g npm@11.3.0

# Copy package files
COPY package*.json ./

# Install production dependencies with exact versions
RUN npm cache clean --force && \
    npm install --only=production --legacy-peer-deps --no-audit --no-progress

# Copy only necessary files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY src/shared/database/prisma ./src/shared/database/prisma

# Set environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8088

# Expose ports
EXPOSE 8088
EXPOSE 5555

# Health check (using HTTP since SSL termination is handled by Nginx)
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
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