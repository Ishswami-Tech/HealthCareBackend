#!/bin/sh

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to start..."
retries=0
max_retries=30
retry_interval=2
until PGPASSWORD=$POSTGRES_PASSWORD psql -h postgres -p 5432 -U "postgres" -c "\q"; do
  >&2 echo "PostgreSQL is unavailable - sleeping (attempt $retries/$max_retries)"
  retries=$((retries+1))
  
  if [ $retries -ge $max_retries ]; then
    echo "Maximum retries reached. PostgreSQL is still unavailable."
    exit 1
  fi
  
  sleep $retry_interval
done

echo "PostgreSQL is up - executing commands"

# Generate Prisma Client
echo "Generating Prisma Client..."
npx prisma generate --schema=$PRISMA_SCHEMA_PATH

# Run Prisma Migrations
echo "Running Prisma Migrations..."
npx prisma migrate deploy --schema=$PRISMA_SCHEMA_PATH

# Seed the database
echo "Seeding the database..."
npx ts-node src/shared/database/prisma/seed.ts

# Start Prisma Studio in the background
echo "Starting Prisma Studio..."
npx prisma studio --schema=$PRISMA_SCHEMA_PATH --port 5555 --hostname 0.0.0.0 &

# Start the NestJS application
echo "Starting NestJS application..."
npm run start:dev 