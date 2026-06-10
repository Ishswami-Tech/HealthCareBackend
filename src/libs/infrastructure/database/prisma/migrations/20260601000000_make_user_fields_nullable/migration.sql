-- Make email, password, and age nullable to support phone-only OTP registration
-- This migration fixes schema drift where Prisma schema marks fields as optional but database still enforces NOT NULL

-- Make email nullable (supports phone-only registration)
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;

-- Make password nullable (supports OTP-only authentication without password)
ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;

-- Make age nullable (not always provided during registration)
ALTER TABLE "users" ALTER COLUMN "age" DROP NOT NULL;
