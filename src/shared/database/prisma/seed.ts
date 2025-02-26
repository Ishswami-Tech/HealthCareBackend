import { PrismaClient } from '@prisma/client';
import { faker } from "@faker-js/faker";
import {
  Role,
  Gender,
  AppointmentStatus,
  PaymentStatus,
  PaymentMethod,
  AppointmentType,
  Prakriti
} from '@prisma/client';

const SEED_COUNT = 50;
const prisma = new PrismaClient();

async function waitForDatabase() {
  let retries = 5;
  while (retries > 0) {
    try {
      await prisma.$connect();
      return;
    } catch (err) {
      console.log(`Database connection failed. ${retries} retries remaining...`);
      retries--;
      await new Promise(res => setTimeout(res, 2000)); // Wait 2 seconds
    }
  }
  throw new Error('Unable to connect to database');
}

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
    await waitForDatabase();
    
    console.log('Cleaning database...');
    await cleanDatabase();
    
    console.log('Starting database seeding...');

    // Create Clinics
    console.log('Creating clinics...');
    const clinics = await Promise.all(
      Array(SEED_COUNT).fill(null).map(() => 
        prisma.clinic.create({
          data: {
            name: faker.company.name(),
            address: faker.location.streetAddress(),
            phone: faker.phone.number(),
          }
        })
      )
    );

    // Create Users
    console.log('Creating users...');
    const users = await Promise.all([
      // Admin
      prisma.user.create({
        data: {
          email: 'admin@example.com',
          password: 'admin123',
          name: 'Admin User',
          age: 30,
          firstName: 'Admin',
          lastName: 'User',
          phone: '1234567890',
          role: Role.SUPER_ADMIN,
          gender: Gender.MALE,
          isVerified: true,
        },
      }),
      
      // Doctors
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

      // Patients
      ...Array(SEED_COUNT).fill(null).map(() => 
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

    // Create Doctors
    console.log('Creating doctors...');
    const doctorUsers = users.filter(u => u.role === Role.DOCTOR);
    const doctors = await Promise.all(
      doctorUsers.map(user => 
        prisma.doctor.create({
          data: {
            id: user.id,
            userId: user.id,
            specialization: faker.person.jobTitle(),
            experience: faker.number.int({ min: 1, max: 30 }),
            qualification: faker.person.jobType(),
            rating: faker.number.float({ min: 3, max: 5, fractionDigits: 1 }),
            isAvailable: true,
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
            id: user.id,
            userId: user.id,
            prakriti: faker.helpers.arrayElement(Object.values(Prakriti)),
          }
        })
      )
    );

    // Create Therapies
    console.log('Creating therapies...');
    const therapies = await Promise.all(
      Array(SEED_COUNT).fill(null).map(() => 
        prisma.therapy.create({
          data: {
            name: faker.commerce.productName(),
            description: faker.commerce.productDescription(),
            duration: faker.number.int({ min: 30, max: 120 }),
          }
        })
      )
    );

    // Create Appointments
    console.log('Creating appointments...');
    await Promise.all(
      Array(SEED_COUNT).fill(null).map(async () => {
        const appointmentDate = faker.date.future();
        return prisma.appointment.create({
          data: {
            patientId: faker.helpers.arrayElement(patients).id,
            doctorId: faker.helpers.arrayElement(doctors).id,
            date: appointmentDate,
            time: appointmentDate.toLocaleTimeString('en-US', { hour12: false }),
            status: faker.helpers.arrayElement(Object.values(AppointmentStatus)),
            type: faker.helpers.arrayElement(Object.values(AppointmentType)),
            duration: 30,
            notes: faker.lorem.paragraph(),
            therapyId: faker.helpers.arrayElement(therapies).id,
          }
        });
      })
    );

    // Create Prescriptions
    console.log('Creating prescriptions...');
    await Promise.all(
      Array(SEED_COUNT).fill(null).map(() => 
        prisma.prescription.create({
          data: {
            patientId: faker.helpers.arrayElement(patients).id,
            doctorId: faker.helpers.arrayElement(doctors).id,
            notes: faker.lorem.paragraph(),
            items: {
              create: Array(3).fill(null).map(() => ({
                dosage: faker.number.int({ min: 1, max: 3 }) + " times daily",
                frequency: "Every " + faker.number.int({ min: 4, max: 12 }) + " hours",
                duration: faker.number.int({ min: 3, max: 30 }) + " days",
              }))
            }
          }
        })
      )
    );

    console.log('Seeding completed');
  } catch (error) {
    console.error('Seed failed:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
