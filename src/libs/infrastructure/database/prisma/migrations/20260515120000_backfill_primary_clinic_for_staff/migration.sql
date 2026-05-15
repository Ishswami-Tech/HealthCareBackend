-- Backfill primaryClinicId for staff users that already have a clinic assignment
-- This keeps auth/session resolution consistent for existing Doctor and ClinicAdmin accounts.

-- Prefer ClinicAdmin assignments first because they represent explicit clinic ownership/admin scope.
WITH clinic_admin_backfill AS (
  SELECT DISTINCT ON (u.id)
    u.id AS user_id,
    ca."clinicId" AS clinic_id
  FROM "users" u
  INNER JOIN "ClinicAdmin" ca ON ca."userId" = u.id
  WHERE u."primaryClinicId" IS NULL
    AND ca."clinicId" IS NOT NULL
  ORDER BY
    u.id,
    ca."isOwner" DESC,
    ca."createdAt" ASC,
    ca."clinicId" ASC
)
UPDATE "users" u
SET "primaryClinicId" = cab.clinic_id
FROM clinic_admin_backfill cab
WHERE u.id = cab.user_id
  AND u."primaryClinicId" IS NULL;

-- Then backfill Doctor users from their clinic assignments.
WITH doctor_backfill AS (
  SELECT DISTINCT ON (u.id)
    u.id AS user_id,
    dc."clinicId" AS clinic_id
  FROM "users" u
  INNER JOIN "Doctor" d ON d."userId" = u.id
  INNER JOIN "DoctorClinic" dc ON dc."doctorId" = d.id
  WHERE u."primaryClinicId" IS NULL
    AND dc."clinicId" IS NOT NULL
  ORDER BY
    u.id,
    dc."clinicId" ASC
)
UPDATE "users" u
SET "primaryClinicId" = db.clinic_id
FROM doctor_backfill db
WHERE u.id = db.user_id
  AND u."primaryClinicId" IS NULL;
