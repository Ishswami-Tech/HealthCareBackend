// Local test-account generator for roles with NO usable login in this dev database —
// ASSISTANT_DOCTOR, THERAPIST, LAB_TECHNICIAN, FINANCE_BILLING, SUPPORT_STAFF, NURSE, COUNSELOR,
// CLINIC_LOCATION_HEAD. seed.ts's own staff-role creation (`createStaffRoleUsers`,
// `locationHeadUsers`) only runs inside its FORCE_FULL_SEED-gated main() path, which has never
// actually executed in this environment (confirmed: zero rows for any of these roles) — so those
// roles have been untestable all session despite the seed script appearing to cover them.
//
// NOT wired into `seed:dev` / `seed:prod` and never run in production (refuses when
// NODE_ENV=production). Idempotent: each account uses a fixed, memorable email
// (`<role>.aadesh1@example.com`), so re-running finds the existing row and does nothing.
//
// Run with:
//   yarn ts-node -r tsconfig-paths/register src/libs/infrastructure/database/prisma/seed-staff-roles-test.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { getEnvWithDefault, isProduction } from '../../../../config/environment/utils';

if (isProduction()) {
  throw new Error('seed-staff-roles-test.ts must never run in production — refusing.');
}

const connectionString =
  getEnvWithDefault('DIRECT_URL', '') || getEnvWithDefault('DATABASE_URL', '');
if (!connectionString) {
  throw new Error('DATABASE_URL or DIRECT_URL environment variable is required');
}
const adapter = new PrismaPg({ connectionString, max: 10, connectionTimeoutMillis: 10000 });
const prisma: PrismaClient = new PrismaClient({
  adapter,
  log: ['error', 'warn'],
  errorFormat: 'minimal',
});

const PASSWORD = 'test1234';

async function assignRoleToUser(userId: string, roleName: string, clinicId: string): Promise<void> {
  let rbacRole = await prisma.rbacRole.findFirst({
    where: { name: roleName, domain: 'healthcare', clinicId: null },
  });
  if (!rbacRole) {
    rbacRole = await prisma.rbacRole.create({
      data: {
        name: roleName,
        displayName: roleName.replace(/_/g, ' '),
        description: `${roleName} role`,
        domain: 'healthcare',
        clinicId: null,
        isSystemRole: true,
        isActive: true,
      },
    });
  }
  const existing = await prisma.userRole.findFirst({
    where: { userId, roleId: rbacRole.id, clinicId, isActive: true },
  });
  if (!existing) {
    await prisma.userRole.create({
      data: {
        userId,
        roleId: rbacRole.id,
        clinicId,
        assignedBy: 'SYSTEM',
        isActive: true,
        isPrimary: true,
      },
    });
  }
}

/** The simple { userId, clinicId?, locationId? } staff models — Therapist, LabTechnician,
 *  FinanceBilling, SupportStaff, Nurse, Counselor are all structurally identical. */
async function ensureSimpleStaffUser(
  delegate: {
    findUnique: (a: unknown) => Promise<unknown>;
    create: (a: unknown) => Promise<unknown>;
  },
  roleValue: string,
  emailPrefix: string,
  displayName: string,
  clinicId: string,
  locationId: string,
  phoneSuffix: number
): Promise<string> {
  const email = `${emailPrefix}.aadesh1@example.com`;
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash(PASSWORD, 12),
        name: `Aadesh ${displayName}1`,
        age: 32,
        firstName: 'Aadesh',
        lastName: `${displayName}1`,
        phone: `900300${String(phoneSuffix).padStart(4, '0')}`,
        role: roleValue as never,
        gender: 'OTHER',
        isVerified: true,
        userid: `UID_${emailPrefix.toUpperCase()}_1`,
        clinics: { connect: { id: clinicId } },
        primaryClinicId: clinicId,
      },
    });
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(PASSWORD, 12),
        role: roleValue as never,
        isVerified: true,
      },
    });
  }
  const profile = await delegate.findUnique({ where: { userId: user.id } });
  if (!profile) {
    await delegate.create({ data: { userId: user.id, clinicId, locationId } });
  }
  await assignRoleToUser(user.id, roleValue, clinicId);
  console.log(`  ✓ ${roleValue}: ${email} / ${PASSWORD}`);
  return user.id;
}

async function ensureAssistantDoctor(clinicId: string, locationId: string): Promise<void> {
  const email = 'assistantdoctor.aadesh1@example.com';
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash(PASSWORD, 12),
        name: 'Aadesh AssistantDoctor1',
        age: 29,
        firstName: 'Aadesh',
        lastName: 'AssistantDoctor1',
        phone: '9004000001',
        role: 'ASSISTANT_DOCTOR' as never,
        gender: 'OTHER',
        isVerified: true,
        userid: 'UID_ASSISTANTDOCTOR_1',
        clinics: { connect: { id: clinicId } },
        primaryClinicId: clinicId,
      },
    });
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(PASSWORD, 12),
        role: 'ASSISTANT_DOCTOR' as never,
        isVerified: true,
      },
    });
  }
  const doctorRecord = await prisma.doctor.findUnique({ where: { userId: user.id } });
  if (!doctorRecord) {
    await prisma.doctor.create({
      data: {
        id: user.id,
        userId: user.id,
        specialization: 'General Medicine',
        experience: 3,
        qualification: 'BAMS',
        rating: 4.2,
        isAvailable: true,
        consultationFee: 800,
      },
    });
  }
  const doctorClinicRel = await prisma.doctorClinic.findFirst({
    where: { doctorId: user.id, clinicId, locationId },
  });
  if (!doctorClinicRel) {
    await prisma.doctorClinic.create({
      data: {
        doctorId: user.id,
        clinicId,
        locationId,
        startTime: new Date(new Date().setUTCHours(9, 0, 0, 0)),
        endTime: new Date(new Date().setUTCHours(18, 0, 0, 0)),
      },
    });
  }
  await assignRoleToUser(user.id, 'ASSISTANT_DOCTOR', clinicId);
  console.log(`  ✓ ASSISTANT_DOCTOR: ${email} / ${PASSWORD}`);
}

async function ensureLocationHead(clinicId: string, locationId: string): Promise<void> {
  const email = 'locationhead.aadesh1@example.com';
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash(PASSWORD, 12),
        name: 'Aadesh LocationHead1',
        age: 40,
        firstName: 'Aadesh',
        lastName: 'LocationHead1',
        phone: '9005000001',
        role: 'CLINIC_LOCATION_HEAD' as never,
        gender: 'OTHER',
        isVerified: true,
        userid: 'UID_LOCATIONHEAD_1',
        clinics: { connect: { id: clinicId } },
        primaryClinicId: clinicId,
      },
    });
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(PASSWORD, 12),
        role: 'CLINIC_LOCATION_HEAD' as never,
        isVerified: true,
      },
    });
  }
  const headDelegate = prisma as unknown as {
    locationHead: {
      findFirst: (a: unknown) => Promise<unknown>;
      create: (a: unknown) => Promise<unknown>;
    };
  };
  const existing = await headDelegate.locationHead.findFirst({
    where: { userId: user.id, clinicId, locationId },
  });
  if (!existing) {
    await headDelegate.locationHead.create({
      data: { userId: user.id, clinicId, locationId, assignedBy: 'SYSTEM', isActive: true },
    });
  }
  await assignRoleToUser(user.id, 'CLINIC_LOCATION_HEAD', clinicId);
  console.log(`  ✓ CLINIC_LOCATION_HEAD: ${email} / ${PASSWORD}`);
}

async function main() {
  console.log('=== seed-staff-roles-test: starting ===');
  const clinics = await prisma.clinic.findMany({
    select: { id: true, clinicId: true, name: true },
  });
  if (clinics.length !== 1) {
    throw new Error(`Expected exactly one clinic but found ${clinics.length}. Refusing to guess.`);
  }
  const clinic = clinics[0]!;
  console.log(`Target clinic: ${clinic.name} (${clinic.clinicId}, ${clinic.id})`);

  const locations = await prisma.clinicLocation.findMany({
    where: { clinicId: clinic.id },
    select: { id: true },
  });
  if (locations.length === 0) throw new Error('Target clinic has no locations.');
  const locationId = locations[0]!.id;

  console.log('Creating staff accounts...');
  await ensureSimpleStaffUser(
    prisma.therapist as never,
    'THERAPIST',
    'therapist',
    'Therapist',
    clinic.id,
    locationId,
    1
  );
  await ensureSimpleStaffUser(
    prisma.labTechnician as never,
    'LAB_TECHNICIAN',
    'labtech',
    'LabTech',
    clinic.id,
    locationId,
    2
  );
  await ensureSimpleStaffUser(
    prisma.financeBilling as never,
    'FINANCE_BILLING',
    'financebilling',
    'FinanceBilling',
    clinic.id,
    locationId,
    3
  );
  await ensureSimpleStaffUser(
    prisma.supportStaff as never,
    'SUPPORT_STAFF',
    'supportstaff',
    'SupportStaff',
    clinic.id,
    locationId,
    4
  );
  await ensureSimpleStaffUser(
    prisma.nurse as never,
    'NURSE',
    'nurse',
    'Nurse',
    clinic.id,
    locationId,
    5
  );
  await ensureSimpleStaffUser(
    prisma.counselor as never,
    'COUNSELOR',
    'counselor',
    'Counselor',
    clinic.id,
    locationId,
    6
  );
  await ensureAssistantDoctor(clinic.id, locationId);
  await ensureLocationHead(clinic.id, locationId);

  console.log('\n=== seed-staff-roles-test: done ===');
  console.log('All accounts use password: test1234');
}

main()
  .catch(e => {
    console.error('seed-staff-roles-test failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
