-- Add missing profile completion flag to users
ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "isProfileComplete" BOOLEAN NOT NULL DEFAULT false;

