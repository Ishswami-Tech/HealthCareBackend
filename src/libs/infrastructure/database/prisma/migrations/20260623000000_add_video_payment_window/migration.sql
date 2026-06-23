-- Add paymentExpiresAt column to Appointment model.
--
-- Used by video appointments to drive the patient-side payment countdown
-- and the backend auto-cancel scheduler. NULL for in-person (subscription)
-- appointments because they don't require per-appointment payment.

ALTER TABLE "Appointment"
  ADD COLUMN "paymentExpiresAt" TIMESTAMP(3);

-- Index helps the every-minute scheduler cheaply find rows whose payment
-- window has expired without scanning the whole table.
CREATE INDEX "Appointment_clinicId_status_paymentExpiresAt_idx"
  ON "Appointment" ("clinicId", "status", "paymentExpiresAt");