-- Add EXPIRED to the AppointmentStatus enum for confirmed video appointments
-- that never start within the allowed join window.
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
