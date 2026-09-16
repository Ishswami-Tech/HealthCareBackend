-- Add deletedAt column to tables that reference it in the Prisma schema
-- This migration was missing from the original schema changes

-- Add deletedAt to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- Add index for soft-delete queries
CREATE INDEX IF NOT EXISTS "users_deletedAt_idx" ON "users"("deletedAt");
