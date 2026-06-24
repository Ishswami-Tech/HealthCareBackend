-- Add confirmationExpiresAt column to Appointment model.
--
-- Populated when an appointment transitions to CONFIRMED. The backend
-- scheduler (VideoAppointmentSchedulerService.handleExpiredConfirmedVideoAppointments)
-- expires confirmed appointments at this time if no one has completed
-- the visit. Window length is VIDEO_ACTIVE_WINDOW_MINUTES (default 300
-- = 5h) measured from the scheduled start time. Surfaced in the API
-- response so the frontend can render a live "Expires in" countdown.

ALTER TABLE "Appointment"
  ADD COLUMN "confirmationExpiresAt" TIMESTAMP(3);

-- Index keeps the every-minute scheduler cheap: it filters by clinic,
-- status (only CONFIRMED/SCHEDULED can be auto-expired), and the
-- expiry timestamp.
CREATE INDEX "Appointment_clinicId_status_confirmationExpiresAt_idx"
  ON "Appointment" ("clinicId", "status", "confirmationExpiresAt");
