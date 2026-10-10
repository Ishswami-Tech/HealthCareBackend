-- Search and sort indexes for the patient directory (tens of thousands of patients per clinic).
-- Idempotent. pg_trgm makes "contains" searches on names, phones and OPD numbers use an index.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Name search: every typed word is matched as a substring against name, first and last name.
CREATE INDEX IF NOT EXISTS "users_name_trgm_idx" ON "users" USING gin (lower("name") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "users_firstName_trgm_idx" ON "users" USING gin (lower("firstName") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "users_lastName_trgm_idx" ON "users" USING gin (lower("lastName") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "users_city_lower_idx" ON "users" (lower("city"));
CREATE INDEX IF NOT EXISTS "users_state_lower_idx" ON "users" (lower("state"));

-- Phone / e-mail search over contact points (imported patients keep their mobile here).
CREATE INDEX IF NOT EXISTS "patient_contact_points_value_trgm_idx"
  ON "patient_contact_points" USING gin ("value" gin_trgm_ops);

-- OPD number search ("VM-2018/6", "2018/609").
CREATE INDEX IF NOT EXISTS "patient_visits_opdNumber_trgm_idx"
  ON "patient_visits" USING gin ("opdNumber" gin_trgm_ops);

-- Visit aggregates, date-range and reference filters, and "last visit" sorting.
CREATE INDEX IF NOT EXISTS "patient_visits_clinic_patient_date_idx"
  ON "patient_visits" ("clinicId", "patientId", "registrationDate");
CREATE INDEX IF NOT EXISTS "patient_visits_clinic_reference_idx"
  ON "patient_visits" ("clinicId", "referenceSource") WHERE "referenceSource" IS NOT NULL;

-- Default sort (newest first) and the "belongs to this clinic" check.
CREATE INDEX IF NOT EXISTS "Patient_createdAt_idx" ON "Patient" ("createdAt");
CREATE INDEX IF NOT EXISTS "Appointment_clinic_patient_idx" ON "Appointment" ("clinicId", "patientId");
