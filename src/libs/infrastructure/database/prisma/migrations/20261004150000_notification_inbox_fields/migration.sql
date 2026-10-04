-- Notification inbox fields (schema.prisma `Notification`, table "Notification").
-- The web header bell and the mobile notifications screens read `title`, `category`,
-- `data` (deep-link payload: appointmentId / prescriptionId / route), `appointmentId`
-- and `readAt`; none of these columns existed, so rows could not deep-link and the
-- clients derived titles/categories from the message text.
-- Idempotent: every statement is guarded, safe to re-run.

ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "data" JSONB;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "appointmentId" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);

-- Inbox list is ordered by createdAt per user; deep-link lookups go by appointment.
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_appointmentId_idx" ON "Notification"("appointmentId");
