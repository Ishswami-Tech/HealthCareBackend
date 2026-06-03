-- Add optional social auth provider IDs to users
-- These fields support login via Google, Facebook, and Apple OAuth providers

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "googleId" TEXT,
  ADD COLUMN IF NOT EXISTS "facebookId" TEXT,
  ADD COLUMN IF NOT EXISTS "appleId" TEXT;

