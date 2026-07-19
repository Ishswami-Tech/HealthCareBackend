-- Backfill WhatsApp notification preferences for all doctors
-- Part of fix: Doctor WhatsApp Daily-Summary Notifications Never Delivered

-- 1. Update existing NotificationPreference rows for doctors: enable WhatsApp
UPDATE "NotificationPreference" np
SET
  "whatsappEnabled" = true,
  "updatedAt" = NOW()
FROM "users" u
JOIN "Doctor" d ON d."userId" = u.id
WHERE np."userId" = u.id
  AND u."role" = 'DOCTOR'
  AND np."whatsappEnabled" = false;

-- 2. Insert preference rows for doctors that have none
INSERT INTO "NotificationPreference" (
  id, "userId", "emailEnabled", "smsEnabled", "pushEnabled", "socketEnabled",
  "whatsappEnabled", "appointmentEnabled", "ehrEnabled", "billingEnabled", "systemEnabled",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  u.id,
  true,  -- emailEnabled
  true,  -- smsEnabled
  true,  -- pushEnabled
  true,  -- socketEnabled
  true,  -- whatsappEnabled (opt-out for doctors)
  true,  -- appointmentEnabled
  true,  -- ehrEnabled
  true,  -- billingEnabled
  true,  -- systemEnabled
  NOW(),
  NOW()
FROM "users" u
JOIN "Doctor" d ON d."userId" = u.id
WHERE u."role" = 'DOCTOR'
  AND NOT EXISTS (
    SELECT 1 FROM "NotificationPreference" np WHERE np."userId" = u.id
  );
