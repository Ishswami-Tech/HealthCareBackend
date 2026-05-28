-- Add optional social auth provider IDs to users
-- These fields support login via Google, Facebook, and Apple OAuth providers

BEGIN;

ALTER TABLE "users"
  ADD COLUMN "googleId" TEXT,
  ADD COLUMN "facebookId" TEXT,
  ADD COLUMN "appleId" TEXT;

COMMIT;

