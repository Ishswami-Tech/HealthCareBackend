# Appointment Endpoints Test Scripts

This directory contains role-based test scripts for appointment endpoints. For comprehensive documentation, see the main [test-scripts/README.md](../README.md).

## Quick Reference

### Run All Appointment Tests (Recommended)

```bash
# Sequential (recommended - ensures proper test ordering)
node test-scripts/appointments/test-all-appointments-sequential.js

# Parallel
node test-scripts/appointments/test-all-appointments.js
```

### Run Tests for a Specific Role

```bash
# PATIENT role
node test-scripts/appointments/test-patient-appointments.js

# DOCTOR role
node test-scripts/appointments/test-doctor-appointments.js

# RECEPTIONIST role
node test-scripts/appointments/test-receptionist-appointments.js

# CLINIC_ADMIN role
node test-scripts/appointments/test-clinic-admin-appointments.js
```

## Test Coverage

- **PATIENT**: 17 endpoints (create, view own, update, cancel, check-in, video, etc.)
- **DOCTOR**: 14 endpoints (view assigned, start/complete consultation, follow-ups, analytics)
- **RECEPTIONIST**: 16 endpoints (create, manage, force check-in, video room creation)
- **CLINIC_ADMIN**: 12 endpoints (view all, analytics, check-in locations)

## Sequential Test Order

The sequential runner executes in this order:
1. **RECEPTIONIST** - Creates appointments for other roles to use
2. **PATIENT** - Creates and manages own appointments
3. **DOCTOR** - Uses appointments created by RECEPTIONIST
4. **CLINIC_ADMIN** - Uses existing appointments for testing

## For More Information

See the main [test-scripts/README.md](../README.md) for:
- Complete endpoint list
- Test user credentials
- Troubleshooting guide
- Adding new tests
- Test patterns and best practices
