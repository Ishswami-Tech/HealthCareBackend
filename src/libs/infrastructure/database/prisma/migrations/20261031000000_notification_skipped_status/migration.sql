-- INT-03: a notification no channel can carry (channel disabled, no email / phone / device for
-- it) is recorded as SKIPPED with a reason instead of staying PENDING forever.
-- Idempotent: dev databases may already have the values via `prisma db push`.
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'SKIPPED';
ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'SKIPPED';
