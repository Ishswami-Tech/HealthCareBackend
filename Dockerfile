# Development
FROM node:20-alpine AS development

# Install necessary tools
RUN apk add --no-cache postgresql-client redis busybox-extras

WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install all dependencies (including devDependencies for TypeScript)
RUN npm install

# Copy the rest of the application
COPY . .

# Set Prisma schema path and generate client
ENV PRISMA_SCHEMA_PATH=/app/src/shared/database/prisma/schema.prisma
RUN npx prisma generate --schema=$PRISMA_SCHEMA_PATH

CMD ["npm", "run", "start:dev"]

# Builder stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools
RUN apk add --no-cache \
    python3 \
    make \
    g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for TypeScript)
RUN npm install

# Copy source code
COPY . .

# Set Prisma schema path and generate client
ENV PRISMA_SCHEMA_PATH=/app/src/shared/database/prisma/schema.prisma
RUN npx prisma generate --schema=$PRISMA_SCHEMA_PATH

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install build dependencies and tools
RUN apk add --no-cache \
    postgresql-client \
    python3 \
    redis

# Copy package files first
COPY --from=builder /app/package*.json ./

# Install both production and necessary dev dependencies
RUN npm ci && \
    npm install -g ts-node typescript @types/node && \
    npm install --save-dev @faker-js/faker @types/faker

# Copy the built code and necessary files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Copy Prisma files and generate client
COPY --from=builder /app/src/shared/database/prisma/schema.prisma ./src/shared/database/prisma/schema.prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
ENV PRISMA_SCHEMA_PATH=/app/src/shared/database/prisma/schema.prisma
RUN npx prisma generate --schema=$PRISMA_SCHEMA_PATH

# Make the script executable
COPY src/shared/database/prisma/wait-for-postgres.sh /wait-for-postgres.sh
RUN chmod +x /wait-for-postgres.sh

# Expose ports
EXPOSE 3000 5555

# Use the script as entrypoint
ENTRYPOINT ["/wait-for-postgres.sh"] 