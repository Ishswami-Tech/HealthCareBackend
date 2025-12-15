# Clinic Service

**Purpose:** Multi-tenant clinic management
**Location:** `src/services/clinic`
**Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { ClinicService } from '@services/clinic';

@Injectable()
export class MyService {
  constructor(private readonly clinicService: ClinicService) {}

  async getClinic(clinicId: string) {
    return await this.clinicService.findOne(clinicId);
  }
}
```

---

## Key Features

- ✅ **CRUD Operations** - Complete clinic management
- ✅ **Multi-Location Support** - Multiple clinic locations
- ✅ **Staff Management** - Doctors, nurses, receptionists
- ✅ **Patient Management** - Clinic patients
- ✅ **Public Validation** - App name availability check

---

## API Endpoints

| Endpoint | Method | Role | Description |
|----------|--------|------|-------------|
| `/clinics` | POST | SUPER_ADMIN, CLINIC_ADMIN | Create clinic |
| `/clinics` | GET | SUPER_ADMIN, CLINIC_ADMIN | Get clinics |
| `/clinics/:id` | GET | SUPER_ADMIN, CLINIC_ADMIN, PATIENT | Get clinic by ID |
| `/clinics/:id/doctors` | GET | SUPER_ADMIN, CLINIC_ADMIN, RECEPTIONIST | Get clinic doctors |
| `/clinics/:id/patients` | GET | SUPER_ADMIN, CLINIC_ADMIN, RECEPTIONIST, DOCTOR | Get clinic patients |
| `/clinics/validate-app-name` | POST | Public | Validate app name availability |

[Full API documentation](../../docs/api/README.md)

---

## Usage Examples

```typescript
// Create clinic
const clinic = await this.clinicService.create({
  name: 'My Clinic',
  appName: 'myclinic',
  address: '123 Main St',
});

// Get clinic doctors
const doctors = await this.clinicService.getClinicDoctors(clinicId);

// Validate app name
const isAvailable = await this.clinicService.validateAppName('newclinic');
```

---

## Related Documentation

- [System Architecture](../../docs/architecture/SYSTEM_ARCHITECTURE.md)
- [API Integration Analysis](../../docs/API_INTEGRATION_ANALYSIS.md)

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
