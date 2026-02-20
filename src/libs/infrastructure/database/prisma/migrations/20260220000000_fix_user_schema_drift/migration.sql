-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "age" INTEGER;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "vikriti" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "doshaImbalances" JSONB;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "dinacharya" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ritucharya" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "dietaryRestrictionsJson" JSONB;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lifestyleFactors" JSONB;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "seasonalPatterns" JSONB;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "medicalConditions" TEXT;

-- Profile related
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profileCompletedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "googleId" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "facebookId" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "appleId" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "appName" TEXT;

-- Enums (Safely create if missing)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Prakriti') THEN
        CREATE TYPE "Prakriti" AS ENUM ('VATA', 'PITTA', 'KAPHA', 'VATA_PITTA', 'PITTA_KAPHA', 'VATA_KAPHA', 'TRIDOSHA');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgniType') THEN
        CREATE TYPE "AgniType" AS ENUM ('TIKSHNA', 'MANDA', 'SAMA', 'VISHAMA');
    END IF;
END $$;

-- Add Enum Columns
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "prakriti" "Prakriti";
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "agni" "AgniType";
