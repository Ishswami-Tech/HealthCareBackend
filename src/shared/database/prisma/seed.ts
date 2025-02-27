import { PrismaClient, Prisma } from '@prisma/client';
import { faker } from "@faker-js/faker";

const SEED_COUNT = 50;
const prisma = new PrismaClient();

// Define enums from schema
const Role = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  CLINIC_ADMIN: 'CLINIC_ADMIN',
  DOCTOR: 'DOCTOR',
  PATIENT: 'PATIENT',
  RECEPTIONIST: 'RECEPTIONIST'
} as const;

const Gender = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  OTHER: 'OTHER'
} as const;

const AppointmentStatus = {
  PENDING: 'PENDING',
  SCHEDULED: 'SCHEDULED',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW'
} as const;

const PaymentStatus = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED'
} as const;

const PaymentMethod = {
  CASH: 'CASH',
  CARD: 'CARD',
  UPI: 'UPI',
  NET_BANKING: 'NET_BANKING'
} as const;

const AppointmentType = {
  IN_PERSON: 'IN_PERSON',
  VIDEO_CALL: 'VIDEO_CALL',
  HOME_VISIT: 'HOME_VISIT'
} as const;

const Prakriti = {
  VATA: 'VATA',
  PITTA: 'PITTA',
  KAPHA: 'KAPHA',
  VATA_PITTA: 'VATA_PITTA',
  PITTA_KAPHA: 'PITTA_KAPHA',
  VATA_KAPHA: 'VATA_KAPHA',
  TRIDOSHA: 'TRIDOSHA'
} as const;

const MedicineType = {
  CLASSICAL: 'CLASSICAL',
  PROPRIETARY: 'PROPRIETARY',
  HERBAL: 'HERBAL'
} as const;

const QueueStatus = {
  WAITING: 'WAITING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED'
} as const;

const NotificationType = {
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  PUSH_NOTIFICATION: 'PUSH_NOTIFICATION'
} as const;

const NotificationStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED'
} as const;

const HealthRecordType = {
  LAB_TEST: 'LAB_TEST',
  XRAY: 'XRAY',
  MRI: 'MRI',
  PRESCRIPTION: 'PRESCRIPTION',
  DIAGNOSIS_REPORT: 'DIAGNOSIS_REPORT',
  PULSE_DIAGNOSIS: 'PULSE_DIAGNOSIS'
} as const;

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

    // Create Users with different roles
    console.log('Creating users...');
    const users = await Promise.all([
      // Super Admin
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
      
      // Clinic Admins
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
            role: Role.CLINIC_ADMIN,
            gender: faker.helpers.arrayElement(Object.values(Gender)),
            isVerified: true,
          }
        })
      ),

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
      ),

      // Receptionists
      ...Array(SEED_COUNT).fill(null).map(() => 
        prisma.user.create({
          data: {
            email: faker.internet.email(),
            password: faker.internet.password(),
            name: faker.person.fullName(),
            age: faker.number.int({ min: 20, max: 50 }),
            firstName: faker.person.firstName(),
            lastName: faker.person.lastName(),
            phone: faker.phone.number(),
            role: Role.RECEPTIONIST,
            gender: faker.helpers.arrayElement(Object.values(Gender)),
            isVerified: true,
          }
        })
      )
    ]);

    // Create SuperAdmin
    console.log('Creating super admin...');
    const superAdminUser = users.find(u => u.role === Role.SUPER_ADMIN);
    if (superAdminUser) {
      await prisma.superAdmin.create({
        data: {
          userId: superAdminUser.id
        }
      });
    }

    // Create ClinicAdmins
    console.log('Creating clinic admins...');
    const clinicAdminUsers = users.filter(u => u.role === Role.CLINIC_ADMIN);
    await Promise.all(
      clinicAdminUsers.map((user, index) => 
        prisma.clinicAdmin.create({
          data: {
            userId: user.id,
            clinicId: clinics[index % clinics.length].id
          }
        })
      )
    );

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
            consultationFee: faker.number.float({ min: 500, max: 2000, fractionDigits: 2 })
          }
        })
      )
    );

    // Create DoctorClinic relationships
    console.log('Creating doctor-clinic relationships...');
    await Promise.all(
      doctors.map(doctor => 
        prisma.doctorClinic.create({
          data: {
            doctorId: doctor.id,
            clinicId: faker.helpers.arrayElement(clinics).id,
            startTime: faker.date.future(),
            endTime: faker.date.future()
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
            prakriti: faker.helpers.arrayElement(Object.values(Prakriti))
          }
        })
      )
    );

    // Create Receptionists
    console.log('Creating receptionists...');
    const receptionistUsers = users.filter(u => u.role === Role.RECEPTIONIST);
    await Promise.all(
      receptionistUsers.map(user => 
        prisma.receptionist.create({
          data: {
            userId: user.id,
            clinicId: faker.helpers.arrayElement(clinics).id
          }
        })
      )
    );

    // Create Medicines
    console.log('Creating medicines...');
    const medicines = await Promise.all(
      Array(SEED_COUNT * 3).fill(null).map(() => 
        prisma.medicine.create({
          data: {
            name: faker.commerce.productName(),
            ingredients: faker.commerce.productMaterial(),
            properties: faker.commerce.productDescription(),
            dosage: faker.number.int({ min: 1, max: 3 }) + " times daily",
            manufacturer: faker.company.name(),
            type: faker.helpers.arrayElement(Object.values(MedicineType))
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
            duration: faker.number.int({ min: 30, max: 120 })
          }
        })
      )
    );

    // Create Appointments
    console.log('Creating appointments...');
    const appointments = await Promise.all(
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
            therapyId: faker.helpers.arrayElement(therapies).id
          }
        });
      })
    );

    // Create Payments
    console.log('Creating payments...');
    await Promise.all(
      appointments.map(appointment => 
        prisma.payment.create({
          data: {
            appointmentId: appointment.id,
            amount: faker.number.float({ min: 500, max: 5000 }),
            status: faker.helpers.arrayElement(Object.values(PaymentStatus)),
            method: faker.helpers.arrayElement(Object.values(PaymentMethod)),
            transactionId: faker.string.uuid()
          }
        })
      )
    );

    // Create Queues
    console.log('Creating queues...');
    await Promise.all(
      appointments.map((appointment, index) => 
        prisma.queue.create({
          data: {
            appointmentId: appointment.id,
            queueNumber: index + 1,
            estimatedWaitTime: faker.number.int({ min: 5, max: 60 }),
            status: faker.helpers.arrayElement(Object.values(QueueStatus))
          }
        })
      )
    );

    // Create Prescriptions and PrescriptionItems
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
                medicineId: faker.helpers.arrayElement(medicines).id,
                dosage: faker.number.int({ min: 1, max: 3 }) + " times daily",
                frequency: "Every " + faker.number.int({ min: 4, max: 12 }) + " hours",
                duration: faker.number.int({ min: 3, max: 30 }) + " days"
              }))
            }
          }
        })
      )
    );

    // Create HealthRecords
    console.log('Creating health records...');
    await Promise.all(
      Array(SEED_COUNT).fill(null).map(() => 
        prisma.healthRecord.create({
          data: {
            patientId: faker.helpers.arrayElement(patients).id,
            doctorId: faker.helpers.arrayElement(doctors).id,
            recordType: faker.helpers.arrayElement(Object.values(HealthRecordType)),
            report: faker.lorem.paragraph(),
            fileUrl: faker.internet.url()
          }
        })
      )
    );

    // Create Reviews
    console.log('Creating reviews...');
    await Promise.all(
      Array(SEED_COUNT).fill(null).map(() => 
        prisma.review.create({
          data: {
            patientId: faker.helpers.arrayElement(patients).id,
            doctorId: faker.helpers.arrayElement(doctors).id,
            rating: faker.number.int({ min: 1, max: 5 }),
            comment: faker.lorem.paragraph()
          }
        })
      )
    );

    // Create Products
    console.log('Creating products...');
    await Promise.all(
      Array(SEED_COUNT).fill(null).map(() => 
        prisma.product.create({
          data: {
            name: faker.commerce.productName(),
            description: faker.commerce.productDescription(),
            price: parseFloat(faker.commerce.price()),
            category: faker.commerce.department(),
            stock: faker.number.int({ min: 0, max: 100 })
          }
        })
      )
    );

    // Create Notifications
    console.log('Creating notifications...');
    await Promise.all(
      Array(SEED_COUNT).fill(null).map(() => 
        prisma.notification.create({
          data: {
            userId: faker.helpers.arrayElement(users).id,
            type: faker.helpers.arrayElement(Object.values(NotificationType)),
            message: faker.lorem.sentence(),
            status: faker.helpers.arrayElement(Object.values(NotificationStatus))
          }
        })
      )
    );

    // Create AuditLogs
    console.log('Creating audit logs...');
    await Promise.all(
      Array(SEED_COUNT).fill(null).map(() => 
        prisma.auditLog.create({
          data: {
            userId: faker.helpers.arrayElement(users).id,
            action: faker.helpers.arrayElement(['LOGIN', 'LOGOUT', 'CREATE', 'UPDATE', 'DELETE']),
            ipAddress: faker.internet.ip(),
            device: faker.helpers.arrayElement(['Web', 'Mobile', 'Tablet'])
          }
        })
      )
    );

    console.log('Seeding completed successfully');
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
