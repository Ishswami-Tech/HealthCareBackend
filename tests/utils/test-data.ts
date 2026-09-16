/**
 * Test utilities and shared mocks for the healthcare backend test suite.
 */

export const TEST_CLINIC_ID = '00000000-0000-0000-0000-000000000001';
export const TEST_USER_ID = '00000000-0000-0000-0000-000000000002';
export const TEST_DOCTOR_ID = '00000000-0000-0000-0000-000000000003';
export const TEST_PATIENT_ID = '00000000-0000-0000-0000-000000000004';
export const TEST_ADMIN_ID = '00000000-0000-0000-0000-000000000005';

export const TEST_EMAIL = 'test@healthcare.com';
export const TEST_DOCTOR_EMAIL = 'doctor@healthcare.com';
export const TEST_PATIENT_EMAIL = 'patient@healthcare.com';
export const TEST_ADMIN_EMAIL = 'admin@healthcare.com';

export const TEST_PASSWORD = 'SecurePass123!';
export const TEST_HASHED_PASSWORD =
  '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewFOEhp8pnD6eG3y';

export function createMockUser(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_USER_ID,
    email: TEST_EMAIL,
    firstName: 'Test',
    lastName: 'User',
    name: 'Test User',
    role: 'PATIENT',
    phone: '+919876543210',
    phoneVerified: true,
    phoneVerifiedAt: new Date('2026-01-01'),
    isVerified: true,
    isProfileComplete: true,
    profileCompletedAt: new Date('2026-01-01'),
    dateOfBirth: new Date('1993-04-16'),
    gender: 'MALE',
    address: '123 Test St',
    city: 'Mumbai',
    state: 'Maharashtra',
    country: 'India',
    zipCode: '400001',
    primaryClinicId: TEST_CLINIC_ID,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    lastLogin: new Date('2026-09-01'),
    ...overrides,
  };
}

export function createMockUserResponse(overrides: Record<string, unknown> = {}): Record<
  string,
  unknown
> {
  return {
    id: TEST_USER_ID,
    email: TEST_EMAIL,
    firstName: 'Test',
    lastName: 'User',
    role: 'PATIENT',
    isVerified: true,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    phone: '+919876543210',
    phoneVerified: true,
    phoneVerifiedAt: '2026-01-01T00:00:00.000Z',
    isProfileComplete: true,
    profileComplete: true,
    ...overrides,
  };
}

export function createMockAuthResponse(): Record<string, unknown> {
  return {
    accessToken: 'eyJhbGciOiJIUzI1NiJ9.test.access.token',
    refreshToken: 'eyJhbGciOiJIUzI1NiJ9.test.refresh.token',
    sessionId: 'session-123',
    expiresIn: 900,
    tokenType: 'Bearer',
    user: {
      id: TEST_USER_ID,
      email: TEST_EMAIL,
      firstName: 'Test',
      lastName: 'User',
      role: 'PATIENT',
      isVerified: false,
      clinicId: TEST_CLINIC_ID,
      clinicName: 'Test Clinic',
    },
    requiresVerification: true,
    redirectUrl: '/patient/dashboard',
    message: 'Login successful',
  };
}

export function createMockClinic(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TEST_CLINIC_ID,
    name: 'Test Clinic',
    code: 'CL0001',
    isActive: true,
    email: 'clinic@healthcare.com',
    phone: '+919876543210',
    address: '123 Clinic St, Mumbai',
    ...overrides,
  };
}
