// Local load-test data generator — NOT wired into `seed:dev` / `seed:prod` and never run in
// production (refuses to run when NODE_ENV=production, see the guard below). Run manually with:
//   yarn ts-node -r tsconfig-paths/register src/libs/infrastructure/database/prisma/seed-volume-test.ts
//
// Seeds realistic *volume* on top of whatever `seed.ts` already created, into the one clinic the
// "aadesh" demo accounts (patient.aadesh1@example.com, doctor.aadesh1@example.com, ...) belong to,
// so the app's screens — the receptionist's queue, the doctor's patient list, the pharmacist's
// medicine search — can be exercised under something close to the real target load (500+ patients
// per location, 2000+ medicines) instead of the handful of demo rows `seed.ts` creates.
//
// Idempotent: every row this script creates is tagged (email prefix `loadtest.patient`, medicine
// name prefix `[LT]`, appointment notes prefix `LOADTEST_SEED`), and each section checks what
// already exists before creating more, so re-running tops up to the target counts instead of
// duplicating.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { createRequire } from 'module';
import { getEnvWithDefault, isProduction } from '../../../../config/environment/utils';

const _requireModule = createRequire(__filename);
const faker: {
  internet: { email: () => string };
  person: { firstName: () => string; lastName: () => string };
} = _requireModule('@faker-js/faker').faker;

if (isProduction()) {
  throw new Error('seed-volume-test.ts must never run in production — refusing.');
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

const TARGET_PATIENTS = 520;
const TARGET_MEDICINES = 2100;
const TARGET_APPOINTMENTS = 130;
const LOADTEST_EMAIL_PREFIX = 'loadtest.patient';
const LOADTEST_MEDICINE_PREFIX = '[LT] ';
const LOADTEST_APPOINTMENT_MARKER = 'LOADTEST_SEED';

const RoleValues = { PATIENT: 'PATIENT' as const };

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

/** Runs `items.map(fn)` in bounded-concurrency chunks instead of one giant Promise.all (the pg
 *  pool here is capped at 10 connections). */
async function runInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T, index: number) => Promise<R>
) {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const chunkResults = await Promise.all(chunk.map((item, j) => fn(item, i + j)));
    results.push(...chunkResults);
    if (i % (batchSize * 10) === 0) {
      console.log(`  ... ${Math.min(i + batchSize, items.length)}/${items.length}`);
    }
  }
  return results;
}

const MEDICINE_NAME_POOL = [
  'Ashwagandha Churna',
  'Triphala Churna',
  'Chyawanprash',
  'Brahmi Ghrita',
  'Dashmoolarishta',
  'Saraswatarishta',
  'Arjunarishta',
  'Punarnavadi Mandur',
  'Yograj Guggulu',
  'Kaishore Guggulu',
  'Sitopaladi Churna',
  'Hingvastak Churna',
  'Avipattikar Churna',
  'Gandhak Rasayan',
  'Mahasudarshan Churna',
  'Shatavari Churna',
  'Ashokarishta',
  'Lohasava',
  'Dashang Lepa',
  'Mahanarayan Taila',
  'Kumaryasava',
  'Drakshasava',
  'Khadiradi Vati',
  'Laxmi Vilas Ras',
  'Chandraprabha Vati',
  'Trikatu Churna',
  'Pushyanug Churna',
  'Vasant Kusumakar Ras',
  'Sarpagandha Vati',
  'Rasnadi Guggulu',
  'Gokshuradi Guggulu',
  'Triphala Guggulu',
  'Navayas Lauh',
  'Praval Pishti',
  'Mukta Pishti',
  'Giloy Ghan Vati',
  'Amalaki Rasayan',
  'Bhringaraj Tailam',
  'Neem Churna',
  'Haridra Khand',
];
const MEDICINE_TYPES: Array<'CLASSICAL' | 'PROPRIETARY' | 'HERBAL'> = [
  'CLASSICAL',
  'PROPRIETARY',
  'HERBAL',
];
const MEDICINE_UNITS = ['tablet', 'bottle', 'sachet', 'jar', 'strip'];
const APPOINTMENT_STATUSES: Array<'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED'> = [
  'SCHEDULED',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
];

async function seedPatients(clinicId: string): Promise<void> {
  const existingCount = await prisma.user.count({
    where: { email: { startsWith: LOADTEST_EMAIL_PREFIX } },
  });
  console.log(`Patients: ${existingCount}/${TARGET_PATIENTS} already seeded.`);
  if (existingCount >= TARGET_PATIENTS) {
    console.log('✓ Patients already at target, skipping.');
    return;
  }
  const passwordHash = await bcrypt.hash('test1234', 12);
  const toCreate = Array.from(
    { length: TARGET_PATIENTS - existingCount },
    (_, i) => existingCount + i + 1
  );

  await runInBatches(toCreate, 20, async i => {
    const email = `${LOADTEST_EMAIL_PREFIX}${i}@example.com`;
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return existingUser;
    const user = await prisma.user.create({
      data: {
        email,
        password: passwordHash,
        name: `${firstName} ${lastName}`,
        age: 18 + (i % 65),
        firstName,
        lastName,
        phone: `98${String(1000000 + i).padStart(8, '0')}`,
        role: RoleValues.PATIENT,
        gender: i % 2 === 0 ? 'MALE' : 'FEMALE',
        isVerified: true,
        userid: `UID_LOADTEST_${i}`,
        clinics: { connect: { id: clinicId } },
        primaryClinicId: clinicId,
      },
    });
    await prisma.patient.create({
      data: { userId: user.id, prakriti: 'VATA', dosha: 'PITTA' },
    });
    await assignRoleToUser(user.id, RoleValues.PATIENT, clinicId);
    return user;
  });
  console.log(`✓ Patients seeded up to target (${TARGET_PATIENTS}).`);
}

async function seedMedicines(clinicId: string, locationIds: string[]): Promise<void> {
  const existingCount = await prisma.medicine.count({
    where: { name: { startsWith: LOADTEST_MEDICINE_PREFIX } },
  });
  console.log(`Medicines: ${existingCount}/${TARGET_MEDICINES} already seeded.`);
  if (existingCount >= TARGET_MEDICINES) {
    console.log('✓ Medicines already at target, skipping.');
    return;
  }
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const rows = Array.from({ length: TARGET_MEDICINES - existingCount }, (_, idx) => {
    const i = existingCount + idx + 1;
    const baseName = MEDICINE_NAME_POOL[i % MEDICINE_NAME_POOL.length]!;
    const type = MEDICINE_TYPES[i % MEDICINE_TYPES.length]!;
    const minStockThreshold = 10 + (i % 20);
    // Roughly 1 in 12 intentionally low/out of stock, so the low-stock UI has real rows to show.
    const lowStock = i % 12 === 0;
    const stock = lowStock ? Math.max(0, i % minStockThreshold) : 20 + (i % 300);
    // Spread expiries from already-expired through ~2 years out, so near-expiry views have data.
    const expiryOffsetDays = (i % 760) - 10;
    return {
      name: `${LOADTEST_MEDICINE_PREFIX}${baseName} #${i}`,
      type,
      clinicId,
      locationId: locationIds[i % locationIds.length]!,
      stock,
      price: Math.round((20 + (i % 480)) * 100) / 100,
      category:
        type === 'HERBAL' ? 'Herbal' : type === 'CLASSICAL' ? 'Classical Ayurvedic' : 'Proprietary',
      unit: MEDICINE_UNITS[i % MEDICINE_UNITS.length]!,
      batchNumber: `LT-B${String(i).padStart(5, '0')}`,
      minStockThreshold,
      expiryDate: new Date(now + expiryOffsetDays * DAY_MS),
      isActive: true,
      manufacturer: 'Load Test Supplier',
    };
  });
  // Pure scalar FKs, no relation connects — createMany in large batches is fast.
  for (let i = 0; i < rows.length; i += 500) {
    await prisma.medicine.createMany({ data: rows.slice(i, i + 500) });
    console.log(`  ... ${Math.min(i + 500, rows.length)}/${rows.length}`);
  }
  console.log(`✓ Medicines seeded up to target (${TARGET_MEDICINES}).`);
}

async function seedAppointments(clinicId: string, locationIds: string[]): Promise<void> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const existingCount = await prisma.appointment.count({
    where: { notes: LOADTEST_APPOINTMENT_MARKER, date: { gte: todayStart, lt: todayEnd } },
  });
  console.log(
    `Appointments (today, load-test): ${existingCount}/${TARGET_APPOINTMENTS} already seeded.`
  );
  if (existingCount >= TARGET_APPOINTMENTS) {
    console.log('✓ Appointments already at target for today, skipping.');
    return;
  }

  const doctors = await prisma.doctor.findMany({
    where: { user: { email: { startsWith: 'doctor.aadesh' } } },
    select: { id: true },
  });
  if (doctors.length === 0) {
    console.log(
      '⚠ No aadesh doctor accounts found — skipping appointment seeding (need seed.ts run first).'
    );
    return;
  }
  const patientUsers = await prisma.user.findMany({
    where: { email: { startsWith: LOADTEST_EMAIL_PREFIX } },
    select: { id: true, patient: { select: { id: true } } },
    take: TARGET_APPOINTMENTS - existingCount,
  });
  const patients = patientUsers
    .filter(u => u.patient)
    .map(u => ({ userId: u.id, patientId: u.patient!.id }));
  if (patients.length === 0) {
    console.log('⚠ No load-test patients with Patient records found — run patient seeding first.');
    return;
  }

  const toCreate = TARGET_APPOINTMENTS - existingCount;
  const rows = Array.from({ length: toCreate }, (_, idx) => {
    const i = existingCount + idx;
    const patient = patients[i % patients.length]!;
    const doctorId = doctors[i % doctors.length]!.id;
    const isVideo = i % 3 === 0;
    const status = APPOINTMENT_STATUSES[i % APPOINTMENT_STATUSES.length]!;
    // Spread across a 9am-6pm day in 20-minute slots.
    const slotMinutes = 9 * 60 + ((i * 20) % (9 * 60));
    const hour = Math.floor(slotMinutes / 60);
    const minute = slotMinutes % 60;
    const date = new Date(todayStart);
    date.setHours(hour, minute, 0, 0);
    const checkedIn = status === 'CONFIRMED' || status === 'IN_PROGRESS' || status === 'COMPLETED';
    return {
      type: (isVideo ? 'VIDEO_CALL' : 'IN_PERSON') as 'VIDEO_CALL' | 'IN_PERSON',
      treatmentType: 'GENERAL_CONSULTATION' as const,
      doctorId,
      patientId: patient.patientId,
      userId: patient.userId,
      locationId: isVideo ? null : locationIds[i % locationIds.length]!,
      clinicId,
      date,
      time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      duration: 20,
      status,
      notes: LOADTEST_APPOINTMENT_MARKER,
      ...(checkedIn ? { checkedInAt: date } : {}),
      ...(status === 'COMPLETED' ? { completedAt: date } : {}),
    };
  });
  await prisma.appointment.createMany({ data: rows });
  console.log(`✓ Appointments seeded up to target (${TARGET_APPOINTMENTS} today).`);
}

async function main() {
  console.log('=== seed-volume-test: starting ===');
  const clinics = await prisma.clinic.findMany({
    select: { id: true, clinicId: true, name: true },
  });
  if (clinics.length !== 1) {
    throw new Error(
      `Expected exactly one clinic (the aadesh demo clinic) but found ${clinics.length}. ` +
        `Refusing to guess which to target — check manually.`
    );
  }
  const clinic = clinics[0]!;
  console.log(`Target clinic: ${clinic.name} (${clinic.clinicId}, ${clinic.id})`);

  const locations = await prisma.clinicLocation.findMany({
    where: { clinicId: clinic.id },
    select: { id: true },
  });
  if (locations.length === 0) throw new Error('Target clinic has no locations.');
  const locationIds = locations.map(l => l.id);
  console.log(`Locations: ${locationIds.length}`);

  await seedPatients(clinic.id);
  await seedMedicines(clinic.id, locationIds);
  await seedAppointments(clinic.id, locationIds);

  const [patientCount, medicineCount, apptCount, apptByStatus] = await Promise.all([
    prisma.user.count({
      where: { email: { startsWith: LOADTEST_EMAIL_PREFIX }, role: RoleValues.PATIENT },
    }),
    prisma.medicine.count({
      where: { name: { startsWith: LOADTEST_MEDICINE_PREFIX }, clinicId: clinic.id },
    }),
    prisma.appointment.count({
      where: { notes: LOADTEST_APPOINTMENT_MARKER, clinicId: clinic.id },
    }),
    prisma.appointment.groupBy({
      by: ['status'],
      where: { notes: LOADTEST_APPOINTMENT_MARKER, clinicId: clinic.id },
      _count: true,
    }),
  ]);
  console.log('\n=== seed-volume-test: done ===');
  console.log(`Clinic: ${clinic.name} (${clinic.id})`);
  console.log(`Load-test patients: ${patientCount}`);
  console.log(`Load-test medicines: ${medicineCount}`);
  console.log(`Load-test appointments (all dates): ${apptCount}`);
  console.log(`  by status: ${apptByStatus.map(r => `${r.status}=${r._count}`).join(', ')}`);
}

main()
  .catch(e => {
    console.error('seed-volume-test failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
