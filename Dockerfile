# Use Node.js 18 with Alpine Linux as the base image
FROM node:18-alpine3.18

# Install OpenSSL 3
RUN apk add --no-cache openssl3

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies with --no-legacy-peer-deps flag
RUN npm install --no-legacy-peer-deps

# Copy the rest of the application code
COPY . .

# Set environment variables for Prisma schema paths
ENV PRISMA_SCHEMA_PATH=/app/src/shared/database/prisma/schema.prisma
ENV TENANT_SCHEMA_PATH=/app/src/shared/database/prisma/tenant.schema.prisma

# Verify schema files exist and are readable
RUN test -f "$PRISMA_SCHEMA_PATH" || (echo "Schema file not found at $PRISMA_SCHEMA_PATH" && exit 1)
RUN test -f "$TENANT_SCHEMA_PATH" || (echo "Tenant schema file not found at $TENANT_SCHEMA_PATH" && exit 1)

# Generate Prisma Client for both schemas
RUN npx prisma generate --schema="$PRISMA_SCHEMA_PATH"
RUN npx prisma generate --schema="$TENANT_SCHEMA_PATH"

# Build the application
RUN npm run build

# Expose the port the app runs on
EXPOSE 8088

# Start the application in production mode
CMD ["npm", "run", "start:prod"] 