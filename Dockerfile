# Development
FROM node:20-alpine

# Install necessary tools
RUN apk add --no-cache postgresql-client redis busybox-extras python3 make g++

WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install all dependencies (including devDependencies for TypeScript)
RUN npm install --legacy-peer-deps
RUN npm install @nestjs/event-emitter
RUN npm install -g nodemon

# Copy the startup script first
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

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