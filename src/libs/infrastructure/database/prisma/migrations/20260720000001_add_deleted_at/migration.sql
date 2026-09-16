-- Fix: add missing deletedAt column to users table
-- This column exists in Prisma schema but was never migrated to the database
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletedAt TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deletedAt);
