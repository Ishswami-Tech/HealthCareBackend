#!/bin/sh
set -e

# Get host and port from arguments or use defaults
host="${1:-postgres}"
port="${2:-5432}"
max_retries=30
retry_interval=2

# Flag file to indicate that seeding has been done
SEED_FLAG_FILE="/app/.seed_completed"

echo "Waiting for PostgreSQL at $host:$port to start..."

# Wait for PostgreSQL
retries=0
until PGPASSWORD=$POSTGRES_PASSWORD psql -h "$host" -p "$port" -U "postgres" -c '\q'; do
  >&2 echo "PostgreSQL is unavailable - sleeping (attempt $retries/$max_retries)"
  retries=$((retries+1))
  
  if [ $retries -ge $max_retries ]; then
    echo "Maximum retries reached. PostgreSQL is still unavailable."
    exit 1
  fi
  
  sleep $retry_interval
done

echo "PostgreSQL is up - executing commands"

# Clean up any existing Prisma client
echo "Cleaning up existing Prisma client..."
rm -rf /app/node_modules/.prisma

# Generate Prisma Client
echo "Generating Prisma Client..."
npx prisma generate --schema=./src/shared/database/prisma/schema.prisma

# Verify client generation
if [ ! -d "/app/node_modules/.prisma/client" ]; then
  echo "Prisma client generation failed"
  exit 1
fi

# Run Prisma Migrations
echo "Running Prisma Migrations..."
npx prisma migrate deploy --schema=./src/shared/database/prisma/schema.prisma

# Don't automatically reset the database in production-like environments
if [ "$NODE_ENV" = "development" ] || [ "$APP_ENV" = "development" ]; then
  echo "Development environment detected."
  # Only reset if explicitly requested via environment variable
  if [ "$RESET_DB" = "true" ]; then
    echo "Resetting database as requested..."
    npx prisma migrate reset --force --schema=./src/shared/database/prisma/schema.prisma
  fi
  
  # Check if seeding has already been done
  if [ ! -f "$SEED_FLAG_FILE" ]; then
    # Seed the database using docker-seed.ts instead of the regular seed
    echo "Seeding the database using docker-seed.ts..."
    npx ts-node src/shared/database/prisma/docker-seed.ts
    
    # Create a flag file to indicate that seeding has been done
    touch "$SEED_FLAG_FILE"
    echo "Created seed flag file to prevent repeated seeding."
  else
    echo "Seed flag file exists, skipping database seeding."
  fi
fi

echo "Database setup complete."

# Return to the calling script instead of exiting
# This allows the start.sh script to continue with starting Prisma Studio and the app