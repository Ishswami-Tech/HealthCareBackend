-- Create missing email_suppression_list table used by EmailSuppressionList model
CREATE TABLE IF NOT EXISTS "email_suppression_list" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "userId" TEXT,
  "clinicId" TEXT,
  "messageId" TEXT,
  "bounceType" TEXT,
  "bounceSubType" TEXT,
  "complaintType" TEXT,
  "description" TEXT,
  "metadata" JSONB,
  "suppressedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_suppression_list_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_reason_clinicId_unique"
ON "email_suppression_list" ("email", "reason", "clinicId");

CREATE INDEX IF NOT EXISTS "email_suppression_list_email_idx"
ON "email_suppression_list" ("email");

CREATE INDEX IF NOT EXISTS "email_suppression_list_userId_idx"
ON "email_suppression_list" ("userId");

CREATE INDEX IF NOT EXISTS "email_suppression_list_clinicId_idx"
ON "email_suppression_list" ("clinicId");

CREATE INDEX IF NOT EXISTS "email_suppression_list_reason_idx"
ON "email_suppression_list" ("reason");

CREATE INDEX IF NOT EXISTS "email_suppression_list_source_idx"
ON "email_suppression_list" ("source");

CREATE INDEX IF NOT EXISTS "email_suppression_list_isActive_idx"
ON "email_suppression_list" ("isActive");

CREATE INDEX IF NOT EXISTS "email_suppression_list_suppressedAt_idx"
ON "email_suppression_list" ("suppressedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'email_suppression_list_userId_fkey'
  ) THEN
    ALTER TABLE "email_suppression_list"
    ADD CONSTRAINT "email_suppression_list_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'email_suppression_list_clinicId_fkey'
  ) THEN
    ALTER TABLE "email_suppression_list"
    ADD CONSTRAINT "email_suppression_list_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
