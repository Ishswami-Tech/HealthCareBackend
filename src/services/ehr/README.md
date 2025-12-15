# EHR Service

**Purpose:** Electronic Health Records management
**Location:** `src/services/ehr`
**Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { EHRService } from '@services/ehr';

@Injectable()
export class MyService {
  constructor(private readonly ehrService: EHRService) {}

  async createLabReport(data: CreateLabReportDto) {
    return await this.ehrService.createLabReport(data);
  }
}
```

---

## Key Features

- ✅ **10 EHR Record Types** - Medical history, lab reports, vitals, allergies, medications, etc.
- ✅ **HIPAA Compliance** - Audit logging, encryption, access control
- ✅ **Analytics** - Health trends and medication adherence
- ✅ **Multi-Tenant** - Clinic-based data isolation
- ✅ **Comprehensive Health Record** - Aggregated patient health data

---

## EHR Record Types (10)

1. **Medical History** - Past medical conditions
2. **Lab Reports** - Laboratory test results
3. **Radiology Reports** - Imaging and radiology results
4. **Surgical Records** - Surgical procedures
5. **Vitals** - Blood pressure, temperature, pulse, etc.
6. **Allergies** - Drug and food allergies
7. **Medications** - Current and past medications
8. **Immunizations** - Vaccination records
9. **Prescriptions** - Prescription history
10. **Clinical Notes** - Doctor's notes

---

## API Endpoints

All EHR endpoints follow pattern: `/ehr/{record-type}/{operation}`

Example: `/ehr/lab-reports` (POST, GET, PUT, DELETE)

[Full API documentation](../../docs/api/README.md)
[API Integration Analysis](../../docs/API_INTEGRATION_ANALYSIS.md)

---

## Usage Examples

```typescript
// Create lab report
const report = await this.ehrService.createLabReport({
  patientId: 'patient123',
  testType: 'Blood Test',
  results: { /* ... */ },
});

// Get comprehensive health record
const healthRecord = await this.ehrService.getComprehensiveRecord(userId);

// Get health trends
const trends = await this.ehrService.getHealthTrends(userId, '30d');
```

---

## Related Documentation

- [Ayurvedic Enhancements](../../docs/features/AYURVEDIC_ENHANCEMENTS.md)
- [API Integration Analysis](../../docs/API_INTEGRATION_ANALYSIS.md)

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
