# Multi-Clinic Healthcare System Architecture

## Overview

This healthcare application now supports **complete data isolation** between multiple clinics. Each clinic has its own patients, doctors, appointments, and all data is fully isolated.

## Architecture Features

- **Multi-Clinic Support**: Up to 200 clinics per application
- **Multi-Location**: Up to 50 locations per clinic  
- **Complete Data Isolation**: Each clinic's data is completely separate
- **10 Lakh+ User Support**: Designed to handle 1 million users across all clinics
- **HIPAA Compliant**: Full healthcare data protection and audit trails

## How It Works

### 1. Clinic Context Middleware

When a request comes in, the middleware extracts clinic ID from:
- **Headers**: `X-Clinic-ID` or `clinic-id`
- **Query Parameters**: `?clinicId=abc123`
- **Path Parameters**: `/clinics/:clinicId/patients`
- **JWT Token**: `clinicId` field in JWT payload
- **Subdomain**: `clinic1.healthapp.com`

```typescript
// Example API calls with clinic context
GET /patients
Headers: { "X-Clinic-ID": "clinic-123" }

GET /appointments?clinicId=clinic-123

GET /clinics/clinic-123/doctors

// JWT with clinic context
Authorization: Bearer <token-with-clinicId>
```

### 2. Data Isolation

**Row-Level Security**: All database queries automatically filter by clinic ID:

```typescript
// When user logs in with clinic ID "clinic-123"
const patients = await patientRepository.getPatientsForClinic("clinic-123");
// Returns ONLY patients for clinic-123

const appointments = await prisma.appointment.findMany();
// Automatically filtered to clinic-123 due to middleware context
```

### 3. Example Usage

#### API Request Flow:
1. User makes request with clinic ID in header
2. Middleware validates clinic exists and user has access
3. Sets database context for clinic isolation
4. All queries return data ONLY for that clinic

#### Sample API Endpoints:
```bash
# Get patients for specific clinic
curl -H "X-Clinic-ID: clinic-123" http://localhost:3000/patients

# Get appointments for clinic
curl -H "X-Clinic-ID: clinic-123" http://localhost:3000/appointments

# Search patients within clinic
curl -H "X-Clinic-ID: clinic-123" http://localhost:3000/patients/search?q=John

# Get clinic locations
curl http://localhost:3000/clinics/clinic-123/locations
```

## Database Architecture

### Clinic Model
```prisma
model Clinic {
  id           String   @id @default(uuid())
  clinicId     String   @unique
  name         String
  subdomain    String?  @unique
  isActive     Boolean  @default(true)
  
  // Relationships
  locations    ClinicLocation[]
  appointments Appointment[]
  users        User[]
  
  // 1 million users distributed across clinics
  // Each clinic can handle ~25,000 patients on average
}
```

### User-Clinic Relationships
```prisma
model User {
  // Primary clinic assignment
  primaryClinicId String?
  primaryClinic   Clinic?  @relation("UserPrimaryClinic")
  
  // Multiple clinic access (for staff who work at multiple clinics)
  clinics         Clinic[] @relation("UserClinics")
}
```

### Data Isolation Examples
```typescript
// Patient data is isolated by clinic
const patients = await prisma.patient.findMany({
  where: {
    appointments: {
      some: {
        clinicId: currentClinicId // Automatically set by middleware
      }
    }
  }
});

// Appointments are clinic-specific
const appointments = await prisma.appointment.findMany({
  where: {
    clinicId: currentClinicId // Row-level security
  }
});
```

## Security Features

### 1. Clinic Access Validation
- Users can only access clinics they're assigned to
- Validates user-clinic relationship before showing data
- Supports both primary clinic and multi-clinic access

### 2. HIPAA Compliance
- Complete audit trails for all data access
- Encrypted data storage and transmission
- Data retention policies per clinic
- Access logging and monitoring

### 3. Rate Limiting
- Per-clinic rate limits to prevent abuse
- Distributed across all clinics fairly
- Protects against data breaches

## Performance Optimizations

### 1. Caching
- Clinic context cached in memory
- User-clinic mappings cached for fast access
- Automatic cache refresh every 5 minutes

### 2. Connection Pooling
- Advanced connection pool manager
- Circuit breaker pattern for reliability
- Health monitoring and metrics

### 3. Query Optimization
- Automatic query batching
- Priority-based queue system
- Healthcare-specific optimizations

## Usage Examples

### Frontend Integration
```javascript
// Set clinic context in API client
const apiClient = axios.create({
  headers: {
    'X-Clinic-ID': userProfile.currentClinicId
  }
});

// All API calls now automatically use clinic context
const patients = await apiClient.get('/patients');
const appointments = await apiClient.get('/appointments');
```

### Backend Service Usage
```typescript
@Injectable()
export class PatientService {
  constructor(
    private simplePatientRepository: SimplePatientRepository,
    private clinicIsolationService: ClinicIsolationService
  ) {}

  async getPatients(clinicId: string) {
    // Automatically handles clinic isolation
    return this.simplePatientRepository.getPatientsForClinic(clinicId);
  }

  async searchPatients(query: string, clinicId: string) {
    // Only searches within the specified clinic
    return this.simplePatientRepository.searchPatients(query, clinicId);
  }
}
```

## Real-World Scale

### Support for 10 Lakh (1 Million) Users:
- **200 Clinics Maximum**
- **50 Locations per Clinic**
- **~5,000 Patients per Clinic on average**
- **500 Staff per Clinic maximum**
- **25,000 Patients per Clinic maximum**

### Performance Metrics:
- Connection pool: 10-100 concurrent connections
- Query optimization with priority queues  
- Automatic load balancing and circuit breakers
- HIPAA-compliant caching with PHI protection

## Deployment Considerations

1. **Environment Variables**:
```env
MULTI_CLINIC_ENABLED=true
MAX_CLINICS_PER_APP=200
MAX_LOCATIONS_PER_CLINIC=50
MAX_PATIENTS_PER_CLINIC=25000
CLINIC_ISOLATION_LEVEL=row
```

2. **Database Scaling**:
- Use read replicas for query distribution
- Implement connection pooling
- Monitor slow queries and optimize

3. **Security Configuration**:
- Enable HIPAA compliance features
- Configure audit logging
- Set up proper backup and disaster recovery

This multi-clinic system provides complete data isolation while maintaining high performance and HIPAA compliance for large-scale healthcare operations.