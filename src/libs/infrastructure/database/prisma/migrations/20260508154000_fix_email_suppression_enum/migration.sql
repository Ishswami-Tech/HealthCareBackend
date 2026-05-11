-- Fix suppression enum drift for fresh and existing local-prod databases.
-- The previous manual table migration created TEXT columns, but the Prisma
-- schema uses PostgreSQL enums. This migration creates the enums if missing
-- and converts both suppression tables to the enum-backed shape.

DO $$
BEGIN
  CREATE TYPE "SuppressionReason" AS ENUM ('BOUNCE', 'COMPLAINT', 'UNSUBSCRIBE', 'MANUAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SuppressionSource" AS ENUM ('SES', 'ZEPTOMAIL', 'USER_ACTION', 'ADMIN', 'SYSTEM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "email_suppression_list"
  ALTER COLUMN "reason" TYPE "SuppressionReason" USING "reason"::text::"SuppressionReason",
  ALTER COLUMN "source" TYPE "SuppressionSource" USING "source"::text::"SuppressionSource";

DO $$
BEGIN
  IF to_regclass('public.whatsapp_suppression_list') IS NOT NULL THEN
    ALTER TABLE "whatsapp_suppression_list"
      ALTER COLUMN "reason" TYPE "SuppressionReason" USING "reason"::text::"SuppressionReason",
      ALTER COLUMN "source" TYPE "SuppressionSource" USING "source"::text::"SuppressionSource";
  END IF;
END $$;
