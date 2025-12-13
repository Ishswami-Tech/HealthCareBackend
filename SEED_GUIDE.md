# Database Seeding Guide

This guide explains how to seed the database with test data for the Healthcare application.

## Quick Start

```bash
# Run the seed script
pnpm seed:dev

# Or manually
npx tsx src/libs/infrastructure/database/prisma/seed.ts
```

## What Gets Created

### 🔐 Admin Accounts
- **Super Admin**: `admin@example.com` / `admin123`
- **Clinic Admin**: `clinicadmin@example.com` / `admin123`

### 🏥 Clinics (2)
1. **Aadesh Ayurvedalay** (Pune, Maharashtra)
   - 3 locations: Main Branch (Koregaon Park), North Branch (Baner), South Branch (Sinhagad Road)
   - Subdomain: `aadesh`
   - Clinic ID: `CL0001`

2. **Shri Vishwamurthi Ayurvedalay** (Mumbai, Maharashtra)
   - 3 locations: Main Branch (Juhu), Andheri Branch, Powai Branch
   - Subdomain: `vishwamurthi`
   - Clinic ID: `CL0002`

### 👥 Demo Users (Easy Testing)

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| Clinic Admin | `clinicadmin1@example.com` | `test1234` | Access to both clinics |
| Doctor | `doctor1@example.com` | `test1234` | General Medicine, 10 years exp |
| Patient | `patient1@example.com` | `test1234` | Vata-Pitta constitution |
| Receptionist | `receptionist1@example.com` | `test1234` | Works at both clinics |

### 📊 Generated Data (per role)
- **50 Clinic Admins** - Randomly distributed across clinics
- **50 Doctors** - With specializations, experience, fees
- **50 Patients** - With Prakriti and Dosha data
- **50 Receptionists** - Associated with clinic locations

### 🏥 In Development Environment Only:
- **100 Medicines** (50 per clinic) - With Ayurvedic properties
- **100 Therapies** (50 per clinic) - Various durations
- **30 Sample Appointments** - Spread over next 30 days
- **2 Demo Appointments** - For `patient1@example.com` with `doctor1@example.com`
  - Tomorrow at 10:00 AM (In-person)
  - Day after tomorrow at 2:00 PM (Video consultation)
- **Payments & Queue entries** for all appointments

## Test IDs Export

After seeding, a `test-ids.json` file is created in the project root with:

```json
{
  "clinics": ["uuid-clinic-1", "uuid-clinic-2"],
  "clinicNames": ["Aadesh Ayurvedalay", "Shri Vishwamurthi Ayurvedalay"],
  "demoDoctorId": "uuid-demo-doctor",
  "demoPatientId": "uuid-demo-patient",
  "demoReceptionistId": "uuid-demo-receptionist",
  "demoClinicAdminId": "uuid-demo-clinic-admin",
  "superAdminId": "uuid-super-admin",
  "doctors": ["uuid-1", "uuid-2", "uuid-3", "uuid-4", "uuid-5"],
  "patients": ["uuid-1", "uuid-2", "uuid-3", "uuid-4", "uuid-5"],
  "locations": {
    "clinic1": ["loc-uuid-1", "loc-uuid-2", "loc-uuid-3"],
    "clinic2": ["loc-uuid-1", "loc-uuid-2", "loc-uuid-3"]
  }
}
```

### Using Test IDs

The test scripts in `test-scripts/` automatically load this file:

```javascript
// Automatically loaded if test-ids.json exists
const clinicId = testIdsFromFile.clinics[0];  // First clinic
const doctorId = testIdsFromFile.demoDoctorId; // Demo doctor
```

You can also use them manually:

```javascript
const testIds = require('./test-ids.json');

// Use in your tests
const clinicId = testIds.clinics[0];
const doctorId = testIds.demoDoctorId;
```

## Appointment Data Details

### Business Hours
All appointments are scheduled during realistic business hours:
- **Time Range**: 9:00 AM - 6:00 PM
- **Time Slots**: :00, :15, :30, :45
- **Durations**: 15, 30, 45, or 60 minutes

### Appointment Types
- **70% In-Person** consultations
- **30% Video** consultations

### Appointment Statuses
- **50% Scheduled** (most common)
- **30% Confirmed**
- **10% Pending**
- **10% Completed** (past appointments)

### Reasons for Visit
- Regular checkup
- Follow-up consultation
- Ayurvedic therapy session
- New patient consultation
- Prakriti analysis
- Dosha balancing treatment

## Re-seeding the Database

**WARNING**: Re-running the seed script will delete ALL existing data!

The seed script automatically:
1. Waits for database connection (5 retries with 2s delay)
2. Cleans all existing data in proper order (respects foreign keys)
3. Creates new seed data

### Safe Re-seeding

```bash
# Backup your database first (optional but recommended)
pg_dump healthcare > backup.sql

# Run seed
pnpm seed:dev

# If you need to restore
psql healthcare < backup.sql
```

## Environment-Specific Behavior

### Development Environment
- Creates full dataset (100 medicines, 100 therapies, 30+ appointments)
- Generates payments and queue entries
- More verbose logging

### Production Environment
- Only creates core data (users, clinics, roles)
- No sample appointments/medicines/therapies
- Minimal logging

Control with `NODE_ENV`:
```bash
NODE_ENV=development pnpm seed:dev  # Full data
NODE_ENV=production pnpm seed:dev   # Core only
```

## Troubleshooting

### "Failed to connect to database"
**Solution**: Ensure PostgreSQL is running and DATABASE_URL is correct
```bash
# Check PostgreSQL status
# Windows
pg_ctl status

# Verify connection string in .env.development
DATABASE_URL="postgresql://user:pass@host:port/database"
```

### "Prisma Client not generated"
**Solution**: Generate Prisma client first
```bash
pnpm prisma:generate
```

### "Foreign key constraint violation"
**Solution**: The clean function might have failed. Manually truncate:
```sql
TRUNCATE TABLE "User" CASCADE;
-- Then run seed again
```

### Seed runs but test-ids.json not created
**Solution**: Check file permissions in project root
```bash
# Windows (PowerShell)
icacls test-ids.json

# Fix permissions if needed
icacls test-ids.json /grant Everyone:F
```

## Customizing Seed Data

### Change Number of Records

Edit `SEED_COUNT` in `seed.ts`:

```typescript
const SEED_COUNT = 50; // Change this number
```

### Add Custom Demo Users

Add more demo users before the `exportTestIds` call:

```typescript
const customDemoUser = await prisma.user.create({
  data: {
    email: 'custom@example.com',
    password: await bcrypt.hash('password123', 10),
    name: 'Custom User',
    // ... other fields
  },
});
```

### Modify Clinic Data

Edit the clinic creation section:

```typescript
const clinic1 = await prisma.clinic.create({
  data: {
    name: 'Your Clinic Name',
    address: 'Your Address',
    phone: '+91-1234567890',
    email: 'contact@yourclinic.com',
    app_name: 'your_clinic_app',
    subdomain: 'yourclinic',
    // ... other fields
  },
});
```

## Integration with Tests

### Automated Test Workflow

1. **Seed the database**:
   ```bash
   pnpm seed:dev
   ```

2. **Run tests** (automatically uses test-ids.json):
   ```bash
   # Test all services
   node test-scripts/test-all-apis.js
   
   # Test specific services
   node test-scripts/auth/test-all-auth-sequential.js
   node test-scripts/appointments/test-all-appointments-sequential.js
   ```

### Manual Testing with Seed Data

Use the demo credentials to test the app manually:

```bash
# Login as doctor
curl -X POST http://localhost:8088/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "doctor1@example.com",
    "password": "test1234"
  }'

# Use the returned token for authenticated requests
curl -X GET http://localhost:8088/api/v1/appointments/my-appointments \
  -H "Authorization: Bearer <token>" \
  -H "X-Clinic-ID: <clinic-id-from-test-ids.json>"
```

## Best Practices

1. **Always seed before testing** - Ensures consistent test environment
2. **Use demo users for manual testing** - Don't create random test accounts
3. **Check test-ids.json** - Verify IDs are exported correctly
4. **Re-seed after schema changes** - Keep data structure in sync
5. **Don't commit test-ids.json** - It's in .gitignore, keep it local

## Adding to CI/CD

```yaml
# Example GitHub Actions workflow
- name: Seed database
  run: pnpm seed:dev
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    NODE_ENV: development

- name: Run tests
  run: |
    pnpm test:auth
    pnpm test:appointments
```

## Related Commands

```bash
# View database in Prisma Studio
pnpm prisma:studio

# Reset database (migrations + seed)
pnpm prisma:migrate:dev --name init

# Just run migrations
pnpm prisma:migrate:dev

# Check migration status
pnpm prisma:migrate status

# Generate Prisma Client
pnpm prisma:generate
```

## Support

For issues or questions:
1. Check PostgreSQL is running: `pg_ctl status`
2. Verify Prisma schema: `pnpm prisma:validate`
3. Check logs during seeding for specific errors
4. Ensure DATABASE_URL is correct in `.env.development`
