-- Quick seed script to create minimal test data for appointment testing
-- Run this with: psql DATABASE_URL < quick-seed.sql

-- Create a super admin user
INSERT INTO "User" (
  id, userid, email, password, name, age, role, "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  'UID000001',
  'admin@healthcare.com',
  '$2b$10$YourHashedPasswordHere',  -- password: Admin@123
  'Super Admin',
  35,
  'SUPER_ADMIN',
  NOW(),
  NOW()
) ON CONFLICT (email) DO NOTHING;

-- Create a clinic
INSERT INTO "Clinic" (
  id, "clinicId", name, address, phone, email, "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  'CLINIC001',
  'Test Healthcare Clinic',
  '123 Main St, City, State',
  '+1234567890',
  'clinic@test.com',
  NOW(),
  NOW()
) ON CONFLICT ("clinicId") DO NOTHING;

-- Create a clinic location
INSERT INTO "ClinicLocation" (
  id, "locationId", name, address, phone, "clinicId", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  'LOC0001',
  'Main Branch',
  '123 Main St, City, State',
  '+1234567890',
  'CLINIC001',
  NOW(),
  NOW()
) ON CONFLICT ("locationId") DO NOTHING;

-- Create a doctor user
INSERT INTO "User" (
  id, userid, email, password, name, age, role, "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  'UID000002',
  'doctor@test.com',
  '$2b$10$YourHashedPasswordHere',  -- password: Doctor@123
  'Dr. John Smith',
  40,
  'DOCTOR',
  NOW(),
  NOW()
) ON CONFLICT (email) DO NOTHING;

-- Create a patient user
INSERT INTO "User" (
  id, userid, email, password, name, age, role, "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  'UID000003',
  'patient@test.com',
  '$2b$10$YourHashedPasswordHere',  -- password: Patient@123
  'Jane Doe',
  28,
  'PATIENT',
  NOW(),
  NOW()
) ON CONFLICT (email) DO NOTHING;

-- Link doctor to clinic (assuming Doctor table structure)
-- Note: Adjust based on actual Doctor table schema

SELECT 'Test data created successfully!' AS result;
