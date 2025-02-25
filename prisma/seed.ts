import {
  PrismaClient,
  Role,
  Gender,
  AppointmentStatus,
  PaymentStatus,
  PaymentMethod,
  AppointmentType,
  Prakriti,
} from "@prisma/client";
import { faker } from "@faker-js/faker";

const prisma = new PrismaClient();
const SEED_COUNT = 10;

async function cleanDatabase() {
  const tablenames = await prisma.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;

  const tables = tablenames
    .map(({ tablename }) => tablename)
    .filter((name) => name !== '_prisma_migrations')
    .map((name) => `"public"."${name}"`)
    .join(', ');

  try {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
  } catch (error) {
    console.log('Error cleaning database:', error);
  }
}

async function main() {
  try {
    console.log('Cleaning database...');
    await cleanDatabase();
    
    console.log('Starting database seeding...');

    // Create Clinics first
    console.log('Creating clinics...');
    const clinics = await Promise.all(
      Array(5).fill(null).map(() => 
        prisma.clinic.create({
          data: {
            name: faker.company.name(),
            address: faker.location.streetAddress(),
            phone: faker.phone.number(),
          }
        })
      )
    );

    // Create Users with different roles
    console.log('Creating users...');
    const users = await Promise.all([
      // Create Admin
      prisma.user.create({
        data: {
          email: 'admin@example.com',
          password: 'admin123',
          name: 'Admin User',
          age: 35,
          firstName: 'Admin',
          lastName: 'User',
          phone: faker.phone.number(),
          role: Role.SUPER_ADMIN,
          gender: Gender.OTHER,
          isVerified: true,
        }
      }),
      
      // Create Doctors
      ...Array(SEED_COUNT).fill(null).map(() => 
        prisma.user.create({
          data: {
            email: faker.internet.email(),
            password: faker.internet.password(),
            name: faker.person.fullName(),
            age: faker.number.int({ min: 30, max: 70 }),
            firstName: faker.person.firstName(),
            lastName: faker.person.lastName(),
            phone: faker.phone.number(),
            role: Role.DOCTOR,
            gender: faker.helpers.arrayElement(Object.values(Gender)),
            isVerified: true,
          }
        })
      ),

      // Create Patients
      ...Array(SEED_COUNT * 2).fill(null).map(() => 
        prisma.user.create({
          data: {
            email: faker.internet.email(),
            password: faker.internet.password(),
            name: faker.person.fullName(),
            age: faker.number.int({ min: 18, max: 80 }),
            firstName: faker.person.firstName(),
            lastName: faker.person.lastName(),
            phone: faker.phone.number(),
            role: Role.PATIENT,
            gender: faker.helpers.arrayElement(Object.values(Gender)),
            isVerified: true,
          }
        })
      )
    ]);

    // Create Doctors and link to clinics
    console.log('Creating doctors...');
    const doctorUsers = users.filter(u => u.role === Role.DOCTOR);
    const doctors = await Promise.all(
      doctorUsers.map(user => 
        prisma.doctor.create({
          data: {
            userId: user.id,
            specialization: faker.person.jobTitle(),
            qualification: faker.person.jobType(),
            experience: faker.number.int({ min: 1, max: 30 }),
            clinics: {
              create: {
                clinicId: faker.helpers.arrayElement(clinics).id,
                startTime: faker.date.future(),
                endTime: faker.date.future(),
              }
            }
          }
        })
      )
    );

    // Create Patients
    console.log('Creating patients...');
    const patientUsers = users.filter(u => u.role === Role.PATIENT);
    const patients = await Promise.all(
      patientUsers.map(user => 
        prisma.patient.create({
          data: {
            userId: user.id,
            prakriti: faker.helpers.arrayElement(Object.values(Prakriti)),
          }
        })
      )
    );

    // Create Appointments
    console.log('Creating appointments...');
    const appointments = await Promise.all(
      patients.map(patient => 
        prisma.appointment.create({
          data: {
            patientId: patient.id,
            doctorId: faker.helpers.arrayElement(doctors).id,
            scheduledAt: faker.date.future(),
            status: faker.helpers.arrayElement(Object.values(AppointmentStatus)),
            type: faker.helpers.arrayElement(Object.values(AppointmentType)),
            reason: faker.lorem.sentence(),
            payment: {
              create: {
                amount: faker.number.float({ min: 500, max: 5000 }),
                status: PaymentStatus.PENDING,
                method: PaymentMethod.CASH,
              }
            }
          }
        })
      )
    );

    console.log('Seeding completed successfully');
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
