-- Database Optimization Script for Healthcare Backend
-- This script adds indexes to improve query performance

-- Index for Log table queries (commonly slow)
CREATE INDEX IF NOT EXISTS idx_logs_timestamp_type_level ON "Log" (timestamp DESC, type, level);
CREATE INDEX IF NOT EXISTS idx_logs_type_timestamp ON "Log" (type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level_timestamp ON "Log" (level, timestamp DESC);

-- Index for Clinic table queries
CREATE INDEX IF NOT EXISTS idx_clinics_clinic_id ON "Clinic" (clinic_id);
CREATE INDEX IF NOT EXISTS idx_clinics_is_active ON "Clinic" (is_active);
CREATE INDEX IF NOT EXISTS idx_clinics_created_by ON "Clinic" (created_by);

-- Index for User table queries
CREATE INDEX IF NOT EXISTS idx_users_email ON "User" (email);
CREATE INDEX IF NOT EXISTS idx_users_role ON "User" (role);
CREATE INDEX IF NOT EXISTS idx_users_primary_clinic_id ON "User" (primary_clinic_id);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON "User" (google_id);
CREATE INDEX IF NOT EXISTS idx_users_is_verified ON "User" (is_verified);

-- Index for ClinicLocation table queries
CREATE INDEX IF NOT EXISTS idx_clinic_locations_clinic_id ON "ClinicLocation" (clinic_id);
CREATE INDEX IF NOT EXISTS idx_clinic_locations_is_active ON "ClinicLocation" (is_active);

-- Index for Appointment table queries
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_id ON "Appointment" (clinic_id);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON "Appointment" (patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_id ON "Appointment" (doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON "Appointment" (status);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON "Appointment" (date);

-- Index for DoctorClinic table queries
CREATE INDEX IF NOT EXISTS idx_doctor_clinic_clinic_id ON "DoctorClinic" (clinic_id);
CREATE INDEX IF NOT EXISTS idx_doctor_clinic_doctor_id ON "DoctorClinic" (doctor_id);

-- Index for ClinicAdmin table queries
CREATE INDEX IF NOT EXISTS idx_clinic_admin_clinic_id ON "ClinicAdmin" (clinic_id);
CREATE INDEX IF NOT EXISTS idx_clinic_admin_user_id ON "ClinicAdmin" (user_id);

-- Index for Receptionist table queries
CREATE INDEX IF NOT EXISTS idx_receptionist_clinic_id ON "Receptionist" (clinic_id);
CREATE INDEX IF NOT EXISTS idx_receptionist_user_id ON "Receptionist" (user_id);

-- Composite indexes for better performance
CREATE INDEX IF NOT EXISTS idx_clinics_active_clinic_id ON "Clinic" (is_active, clinic_id);
CREATE INDEX IF NOT EXISTS idx_users_verified_role ON "User" (is_verified, role);
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_status_date ON "Appointment" (clinic_id, status, date);

-- Analyze tables to update statistics
ANALYZE "Log";
ANALYZE "Clinic";
ANALYZE "User";
ANALYZE "ClinicLocation";
ANALYZE "Appointment";
ANALYZE "DoctorClinic";
ANALYZE "ClinicAdmin";
ANALYZE "Receptionist";

-- Show index usage statistics
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan as index_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes 
WHERE schemaname = 'public'
ORDER BY idx_scan DESC; 