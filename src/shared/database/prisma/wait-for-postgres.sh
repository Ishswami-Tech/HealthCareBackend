#!/bin/sh
set -e

echo "Waiting for PostgreSQL to start..."

# Wait for PostgreSQL
until PGPASSWORD=$POSTGRES_PASSWORD psql -h "postgres" -U "postgres" -c '\q'; do
  >&2 echo "PostgreSQL is unavailable - sleeping"
  sleep 2
done

echo "PostgreSQL is up - executing commands"

# Ensure all dependencies are installed
echo "Installing dependencies..."
npm install --legacy-peer-deps
npm install @fastify/helmet nodemailer

# Clean up any existing Prisma client
rm -rf /app/node_modules/.prisma

# Generate Prisma Client
echo "Generating Prisma Client..."
npx prisma generate --schema=./src/shared/database/prisma/schema.prisma

# Verify client generation
if [ ! -f "/app/node_modules/.prisma/client/index.js" ]; then
  echo "Prisma client generation failed"
  exit 1
fi

# Run Prisma Migrations
echo "Running Prisma Migrations..."
npx prisma migrate deploy --schema=./src/shared/database/prisma/schema.prisma
npx prisma migrate reset --force --schema=./src/shared/database/prisma/schema.prisma

# Seed the database
echo "Seeding the database..."
npx prisma db seed

# Start Prisma Studio in the background
echo "Starting Prisma Studio..."
npx prisma studio --schema=./src/shared/database/prisma/schema.prisma --port 5555 --hostname 0.0.0.0 &

# Start the application
echo "Starting the application..."
npm run start:dev