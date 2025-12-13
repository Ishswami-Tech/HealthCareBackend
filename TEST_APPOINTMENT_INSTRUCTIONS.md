# Appointment Endpoints Testing Guide

This guide explains how to test the appointment endpoints using the automated role-based test scripts.

## ⚠️ Migration Notice

**The old test files have been archived to `test-scripts/archive/`**

The new role-based test structure provides:
- ✅ Comprehensive role-based testing (PATIENT, DOCTOR, RECEPTIONIST, CLINIC_ADMIN)
- ✅ Better organization and maintainability
- ✅ Shared utilities and consistent patterns
- ✅ Sequential execution for proper test ordering

## Prerequisites

1. **Server Running**: Make sure the development server is running:
   ```bash
   pnpm start:dev
   ```

2. **Database Setup**: Ensure PostgreSQL is running and the database is migrated:
   ```bash
   pnpm prisma:migrate:dev
   ```

3. **Test Data**: The test scripts use seeded test users. Ensure you've run the seed script:
   ```bash
   pnpm exec dotenv -e .env.development -- ts-node -r tsconfig-paths/register quick-seed.ts
   ```

## Quick Start

### Test All Appointment Endpoints (All Roles)

```bash
# Test all roles sequentially (recommended)
node test-scripts/appointments/test-all-appointments-sequential.js

# Test all roles in parallel
node test-scripts/appointments/test-all-appointments.js
```

### Test Specific Role

```bash
# Test PATIENT role
node test-scripts/appointments/test-patient-appointments.js

# Test DOCTOR role
node test-scripts/appointments/test-doctor-appointments.js

# Test RECEPTIONIST role
node test-scripts/appointments/test-receptionist-appointments.js

# Test CLINIC_ADMIN role
node test-scripts/appointments/test-clinic-admin-appointments.js
```

### Test All Services

```bash
# Test all services for all roles
node test-scripts/test-all-apis.js
```

## Test Structure

The new test structure is organized as follows:

```
test-scripts/
├── appointments/
│   ├── test-patient-appointments.js          # PATIENT role tests
│   ├── test-doctor-appointments.js           # DOCTOR role tests
│   ├── test-receptionist-appointments.js     # RECEPTIONIST role tests
│   ├── test-clinic-admin-appointments.js     # CLINIC_ADMIN role tests
│   ├── test-all-appointments.js              # Run all roles in parallel
│   ├── test-all-appointments-sequential.js   # Run all roles sequentially
│   └── _shared-utils.js                      # Shared utilities
├── auth/                                      # Auth endpoint tests
├── users/                                     # User endpoint tests
├── clinic/                                    # Clinic endpoint tests
├── billing/                                   # Billing endpoint tests
├── ehr/                                       # EHR endpoint tests
├── video/                                     # Video endpoint tests
├── notification/                              # Notification endpoint tests
└── test-all-apis.js                          # Master test runner
```

## Test Coverage

The appointment test scripts cover the following endpoints for each role:

### Core Appointment Endpoints
1. ✅ **POST /appointments** - Create new appointment
2. ✅ **GET /appointments** - Get all appointments (role-based filtering)
3. ✅ **GET /appointments/my-appointments** - Get current user's appointments (PATIENT)
4. ✅ **GET /appointments/:id** - Get appointment by ID
5. ✅ **PUT /appointments/:id** - Update appointment
6. ✅ **DELETE /appointments/:id** - Cancel appointment
7. ✅ **GET /appointments/doctor/:doctorId/availability** - Check doctor availability
8. ✅ **GET /appointments/user/:userId/upcoming** - Get upcoming appointments

### Appointment Management
9. ✅ **POST /appointments/:id/check-in** - Check in to appointment
10. ✅ **POST /appointments/:id/check-in/force** - Force check-in (staff only)
11. ✅ **POST /appointments/check-in/scan-qr** - Scan QR code for check-in
12. ✅ **GET /appointments/check-in/locations** - Get check-in locations
13. ✅ **POST /appointments/check-in/locations** - Create check-in location (admin)

### Appointment Workflow
14. ✅ **POST /appointments/:id/start** - Start consultation
15. ✅ **POST /appointments/:id/complete** - Complete appointment
16. ✅ **POST /appointments/:id/follow-up** - Create follow-up plan
17. ✅ **GET /appointments/:id/chain** - Get appointment chain
18. ✅ **GET /appointments/:id/follow-ups** - Get follow-up appointments

### Video Consultation
19. ✅ **POST /appointments/:id/video/create-room** - Create video room
20. ✅ **POST /appointments/:id/video/join-token** - Generate join token
21. ✅ **POST /appointments/:id/video/start** - Start video consultation
22. ✅ **POST /appointments/:id/video/end** - End video consultation
23. ✅ **GET /appointments/:id/video/status** - Get video status
24. ✅ **POST /appointments/:id/video/report-issue** - Report technical issue

### Analytics (Admin Only)
25. ✅ **GET /appointments/analytics/wait-times** - Wait time analytics
26. ✅ **GET /appointments/analytics/check-in-patterns** - Check-in patterns
27. ✅ **GET /appointments/analytics/no-show-correlation** - No-show correlation

## Expected Results

### Successful Test Run

```
============================================================
Running All Appointment Endpoint Tests by Role (Sequential)
============================================================

============================================================
Running RECEPTIONIST tests...
============================================================
✓ Create Appointment: PASSED
✓ Get All Appointments: PASSED
✓ Get Appointment By ID: PASSED
...

RECEPTIONIST Test Summary
============================================================
Passed: 16
Failed: 0
Skipped: 0
Total: 16
============================================================

Overall Test Summary
============================================================
Passed: 4/4
  - RECEPTIONIST, PATIENT, DOCTOR, CLINIC_ADMIN
============================================================
```

## Role-Based Permissions

### PATIENT Role
- ✅ Can create appointments
- ✅ Can view own appointments
- ✅ Can update/cancel own appointments
- ✅ Can check in to own appointments
- ❌ Cannot view all appointments
- ❌ Cannot force check-in

### DOCTOR Role
- ✅ Can view appointments assigned to them
- ✅ Can start/complete consultations
- ✅ Can create follow-up plans
- ✅ Can view appointment chains
- ⚠️ May not be able to create appointments (depends on RBAC)

### RECEPTIONIST Role
- ✅ Can create appointments for patients
- ✅ Can view all clinic appointments
- ✅ Can check in patients
- ✅ Can force check-in
- ✅ Can manage check-in locations

### CLINIC_ADMIN Role
- ✅ Can view all clinic appointments
- ✅ Can access analytics endpoints
- ✅ Can manage check-in locations
- ✅ Can view cross-clinic data

## Test Data

The test scripts automatically use seeded test users:

- **PATIENT**: `patient1@example.com` / `test1234`
- **DOCTOR**: `doctor1@example.com` / `test1234`
- **RECEPTIONIST**: `receptionist1@example.com` / `test1234`
- **CLINIC_ADMIN**: `clinicadmin1@example.com` / `test1234`

Test IDs (clinic, doctor, patient, location) are automatically loaded from `test-ids.json` if available, or extracted from API responses.

## Troubleshooting

### Tests Fail with 401 Unauthorized

**Solution**: Ensure the server is running and test users are seeded:
```bash
pnpm exec dotenv -e .env.development -- ts-node -r tsconfig-paths/register quick-seed.ts
```

### Tests Fail with 403 Forbidden

**Solution**: This may be expected for certain roles. The tests handle 403 as valid responses for RBAC permission checks.

### Tests Fail with 404 Not Found

**Solution**: Ensure test data exists (clinics, doctors, locations). The tests will skip tests that require missing data.

### No Appointments Available

**Solution**: The sequential test runner creates appointments in the correct order:
1. RECEPTIONIST creates appointments
2. PATIENT creates appointments
3. DOCTOR uses existing appointments
4. CLINIC_ADMIN uses existing appointments

## Integration with CI/CD

Add to `package.json`:

```json
{
  "scripts": {
    "test:appointments": "node test-scripts/appointments/test-all-appointments-sequential.js",
    "test:auth": "node test-scripts/auth/test-all-auth-sequential.js",
    "test:all": "node test-scripts/test-all-apis.js"
  }
}
```

Then run:
```bash
pnpm test:appointments
pnpm test:all
```

## Migration from Old Test Files

If you were using the old test files:
- `test-appointment-endpoints.js` → Use `test-scripts/appointments/test-*-appointments.js`
- `test-auth-endpoints.js` → Use `test-scripts/auth/test-*-auth.js`
- `test-all-endpoints.js` → Use `test-scripts/test-all-apis.js`

Old files are archived in `test-scripts/archive/` for reference.

## Next Steps

1. ✅ All appointment endpoints are now tested with role-based coverage
2. ✅ All other services (auth, users, clinic, billing, ehr, video, notification) have role-based tests
3. ✅ Use `test-scripts/test-all-apis.js` for comprehensive testing
4. ✅ Each service has sequential test runners for proper test ordering

## Support

If you encounter issues:
1. Check server logs for detailed error messages
2. Verify database schema is up to date (`pnpm prisma:migrate:dev`)
3. Ensure all required services are running (PostgreSQL, Redis/Dragonfly)
4. Review the test output for specific error messages
5. Check `test-scripts/README.md` for more information
