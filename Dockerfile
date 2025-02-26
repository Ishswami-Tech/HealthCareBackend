# Development
FROM node:20-alpine AS development

# Install necessary tools
RUN apk add --no-cache postgresql-client redis busybox-extras

WORKDIR /usr/src/app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

RUN npm run prisma:generate

CMD ["npm", "run", "start:dev"]

# Production
FROM node:20-alpine AS production

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /usr/src/app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install --only=production

COPY . .
RUN mkdir -p public

COPY --from=development /usr/src/app/dist ./dist

CMD ["node", "dist/main"]

FROM node:20 AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Generate Prisma Client first
RUN npx prisma generate --schema=./src/shared/database/prisma/schema.prisma

# Then install global TypeScript
RUN npm install typescript@latest -g

# Finally build
RUN npm run build

FROM node:20

WORKDIR /app

# Install PostgreSQL client
RUN apt-get update && apt-get install -y postgresql-client

# Copy built application
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/package*.json /app/
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/src /app/src
COPY --from=builder /app/node_modules/.prisma /app/node_modules/.prisma

# Make the script executable
COPY src/shared/database/prisma/wait-for-postgres.sh /wait-for-postgres.sh
RUN chmod +x /wait-for-postgres.sh

# Expose ports
EXPOSE 3000 5555

# Use the script as entrypoint
ENTRYPOINT ["/wait-for-postgres.sh"] 