# Appointment Endpoints Testing Guide

This guide explains how to test the appointment endpoints using the automated test script.

## Prerequisites

1. **Server Running**: Make sure the development server is running:
   ```bash
   pnpm start:dev
   ```

2. **Database Setup**: Ensure PostgreSQL is running and the database is migrated:
   ```bash
   pnpm prisma:migrate:dev
   ```

3. **Test Data**: You need at least one doctor and one clinic in the database for appointment tests to work properly.

## Quick Start

### Option 1: Using Environment Variables (Recommended)

Set the required environment variables before running tests:

```bash
# Windows (PowerShell)
$env:TEST_CLINIC_ID="your-clinic-id-here"
$env:TEST_DOCTOR_ID="your-doctor-id-here"
node test-appointment-endpoints.js

# Windows (CMD)
set TEST_CLINIC_ID=your-clinic-id-here
set TEST_DOCTOR_ID=your-doctor-id-here
node test-appointment-endpoints.js

# Linux/Mac
export TEST_CLINIC_ID="your-clinic-id-here"
export TEST_DOCTOR_ID="your-doctor-id-here"
node test-appointment-endpoints.js
```

### Option 2: Using Default Test IDs

The script uses default test IDs if environment variables are not set:
- `TEST_CLINIC_ID`: Defaults to `test-clinic-123`
- `TEST_DOCTOR_ID`: Defaults to `test-doctor-123`

Simply run:
```bash
node test-appointment-endpoints.js
```

**Note**: This will likely fail for actual appointment creation unless you have entities with these IDs in your database.

## Getting Real Test Data

### Method 1: Query the Database

Use Prisma Studio to find existing clinic and doctor IDs:

```bash
pnpm prisma:studio
```

Navigate to:
1. **Clinic** table → Copy an ID
2. **Doctor** table → Copy an ID

### Method 2: Use SQL Queries

Connect to your database and run:

```sql
-- Get a clinic ID
SELECT id FROM "Clinic" LIMIT 1;

-- Get a doctor ID (with user relationship)
SELECT d.id, d.name, u.email
FROM "Doctor" d
JOIN "User" u ON d."userId" = u.id
LIMIT 1;
```

### Method 3: Create Test Data via API

You can create test data using the API endpoints directly:

```bash
# Register as admin/receptionist first, then:
# 1. Create a clinic via POST /api/v1/clinics
# 2. Create a doctor via POST /api/v1/doctors
```

## Test Coverage

The script tests the following endpoints:

### Core Appointment Endpoints
1. ✅ **POST /appointments** - Create new appointment
2. ✅ **GET /appointments/my-appointments** - Get current user's appointments
3. ✅ **GET /appointments** - Get all appointments (staff only)
4. ✅ **GET /appointments/doctor/:doctorId/availability** - Check doctor availability
5. ✅ **GET /appointments/user/:userId/upcoming** - Get upcoming appointments
6. ✅ **GET /appointments/:id** - Get appointment by ID
7. ✅ **PUT /appointments/:id** - Update appointment
8. ✅ **DELETE /appointments/:id** - Cancel appointment

### Video Consultation Endpoints
9. ✅ **POST /appointments/:id/video/create-room** - Create video room (staff only)
10. ✅ **POST /appointments/:id/video/join-token** - Generate join token

## Expected Results

### Successful Scenario

```
========================================
  Appointment Endpoints Test Suite
========================================

=== Test 1: POST /appointments - Create Appointment ===
✓ Create Appointment: OK
ℹ Appointment ID: abc-123-def-456

=== Test 2: GET /appointments/my-appointments ===
✓ Get My Appointments: OK
ℹ Found 1 appointment(s)

=== Test 3: GET /appointments - Get All Appointments (Staff) ===
⚠ Get All Appointments: Expected failure (Patients cannot access)

... (more tests)

========================================
  Test Summary
========================================
Passed: 8
Failed: 0
Skipped: 0
========================================
```

### Common Failures

#### 1. Missing Clinic Context
```
✗ Create Appointment failed: 400 - {"message": "Clinic context is required"}
```
**Solution**: Ensure `X-Clinic-ID` header is set correctly and the clinic exists.

#### 2. Doctor Not Found
```
✗ Create Appointment failed: 404 - {"message": "Doctor not found"}
```
**Solution**: Verify the doctor ID exists in the database and is associated with the clinic.

#### 3. Permission Denied
```
✗ Get All Appointments failed: 403 - {"message": "Insufficient permissions"}
```
**Solution**: This is expected for patient role on certain endpoints (marked as "⚠ Expected failure").

#### 4. Invalid Date/Time
```
✗ Create Appointment failed: 400 - {"message": "Cannot check availability for past dates"}
```
**Solution**: The script uses tomorrow's date, but verify your system clock is correct.

## Customizing Tests

### Modify Appointment Data

Edit the `testCreateAppointment()` function in `test-appointment-endpoints.js`:

```javascript
const appointmentData = {
  doctorId: doctorId,
  date: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Tomorrow
  time: '10:00',
  duration: 30,
  type: 'CONSULTATION',
  reason: 'Custom reason here',
  notes: 'Custom notes here',
};
```

### Add More Tests

Add new test functions following the pattern:

```javascript
async function testCustomEndpoint() {
  console.log('=== Test X: YOUR TEST NAME ===');

  const result = await makeRequest('GET', '/your-endpoint', null, {
    Authorization: `Bearer ${accessToken}`,
    'X-Clinic-ID': clinicId,
  });

  if (result.ok) {
    console.log('✓ Your Test: OK');
  } else {
    console.log(`✗ Your Test failed: ${result.status}`);
  }
  console.log('');
}
```

Then add it to the `tests` array in `runTests()`.

## Troubleshooting

### Tests Pass But No Appointments Created

Check:
1. Database constraints (foreign keys for doctor, patient, clinic)
2. RBAC permissions for the PATIENT role
3. Doctor availability configuration

### Video Endpoints Fail

The video consultation endpoints may require additional setup:
- Jitsi configuration
- Video service initialization
- Proper appointment status (must be CONFIRMED or SCHEDULED)

### Rate Limiting Errors

If you see 429 errors:
```
✗ Test failed: 429 - {"message": "Too many requests"}
```

Wait a few seconds between test runs or adjust rate limits in `.env.development`:
```env
RATE_LIMIT_MAX=1000
AUTH_RATE_LIMIT=10
```

## Integration with CI/CD

To use in automated testing pipelines:

```bash
# Exit with error code on failure
node test-appointment-endpoints.js || exit 1
```

Or add to `package.json`:
```json
{
  "scripts": {
    "test:appointments": "node test-appointment-endpoints.js",
    "test:all": "node test-auth-endpoints.js && node test-appointment-endpoints.js"
  }
}
```

Then run:
```bash
pnpm test:appointments
```

## Next Steps

1. Create similar test scripts for other modules (users, clinics, billing, etc.)
2. Add more comprehensive validation checks
3. Integrate with a proper testing framework (Jest, Mocha, etc.)
4. Add performance benchmarks
5. Create automated data seeding scripts

## Support

If you encounter issues:
1. Check server logs for detailed error messages
2. Verify database schema is up to date (`pnpm prisma:migrate:dev`)
3. Ensure all required services are running (PostgreSQL, Redis/Dragonfly)
4. Review the CLAUDE.md file for architecture guidelines
