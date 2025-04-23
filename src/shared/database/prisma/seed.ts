import { PrismaClient, Role, Gender, Prakriti, Dosha, AppointmentStatus, AppointmentType } from '@prisma/client';
import { faker } from "@faker-js/faker";
import {
  PaymentStatus,
  PaymentMethod,
  MedicineType,
  QueueStatus,
  NotificationType,
  NotificationStatus,
  HealthRecordType,
  getPrismaClient
} from './prisma.types';
import * as bcrypt from 'bcrypt';

const SEED_COUNT = 50;
const prisma = getPrismaClient();

let userIdCounter = 1;
const generateUserId = () => `UID${String(userIdCounter++).padStart(6, '0')}`;

let locationIdCounter = 1;
const generateLocationId = () => `LOC${String(locationIdCounter++).padStart(4, '0')}`;

async function main() {
  try {
    await waitForDatabase();
    
    console.log('Cleaning database...');
    await cleanDatabase();
    
    console.log('Starting comprehensive database seeding...');

    // ===== SUPER ADMIN CREATION =====
    console.log('Creating SuperAdmin user...');
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
    const superAdminUser = await prisma.user.create({
      data: {
        email: 'admin@example.com',
        password: hashedPassword,
        name: 'Admin User',
        age: 30,
        firstName: 'Admin',
        lastName: 'User',
        phone: '1234567890',
        role: Role.SUPER_ADMIN,
        gender: Gender.MALE,
        isVerified: true,
      }
    });

    await prisma.superAdmin.create({
      data: {
        userId: superAdminUser.id
      }
    });

    // ===== CLINIC CREATION =====
    console.log('Creating clinics...');
    
    // Ayurveda Wellness Center
    const clinic1 = await prisma.clinic.create({
      data: {
        name: 'Ayurveda Wellness Center',
        address: '123 Health Street',
        phone: '+91-9876543210',
        email: 'contact@ayurvedawellness.com',
        app_name: 'ayurveda_wellness',
        db_connection_string: 'postgresql://user:pass@localhost:5432/ayurveda_wellness',
        databaseName: 'ayurveda_wellness_db',
        createdBy: superAdminUser.id,
        clinicId: 'CL0001'
      }
    });

    // Create clinic locations
    const location1 = await prisma.clinicLocation.create({
      data: {
        name: 'Main Branch',
        address: '123 Health Street',
        city: 'Mumbai',
        state: 'Maharashtra',
        country: 'India',
        zipCode: '400001',
        phone: '+91-9876543210',
        email: 'main@ayurvedawellness.com',
        clinicId: clinic1.id,
        locationId: 'LOC0001'
      }
    });

    // Create Users with different roles
    console.log('Creating users...');
    const users = await Promise.all([
      // Clinic Admins
      ...Array(SEED_COUNT).fill(null).map(() => 
        prisma.user.create({
          data: {
            id: generateUserId(),
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
            id: generateUserId(),
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
            id: generateUserId(),
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
            id: generateUserId(),
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

    // Create ClinicAdmins with clinic associations
    console.log('Creating clinic admins...');
    const clinicAdminUsers = users.filter(u => u.role === Role.CLINIC_ADMIN);
    await Promise.all(
      clinicAdminUsers.map((user, index) => {
        const clinic = index % 2 === 0 ? clinic1 : clinic1;
        return prisma.clinicAdmin.create({
          data: {
            userId: user.id,
            clinicId: clinic.id,
            isOwner: index < 2 // First admin for each clinic is owner
          }
        });
      })
    );

    // Create Doctors with clinic and location associations
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

    // Create DoctorClinic relationships with locations
    console.log('Creating doctor-clinic relationships...');
    await Promise.all(
      doctors.map(doctor => 
        prisma.doctorClinic.create({
          data: {
            doctorId: doctor.id,
            clinicId: clinic1.id,
            locationId: location1.id,
            startTime: faker.date.future(),
            endTime: faker.date.future()
          }
        })
      )
    );

    // Create Receptionists with clinic associations
    console.log('Creating receptionists...');
    const receptionistUsers = users.filter(u => u.role === Role.RECEPTIONIST);
    await Promise.all(
      receptionistUsers.map(user => {
        const clinic = clinic1;
        
        return prisma.receptionist.create({
          data: {
            userId: user.id,
            clinicId: clinic.id
          }
        });
      })
    );

    // Create Patients with clinic associations
    console.log('Creating patients...');
    const patientUsers = users.filter(u => u.role === Role.PATIENT);
    const patients = await Promise.all(
      patientUsers.map(user => 
        prisma.patient.create({
          data: {
            prakriti: faker.helpers.arrayElement(Object.values(Prakriti)),
            dosha: faker.helpers.arrayElement(Object.values(Dosha)),
            user: {
              connect: {
                id: user.id
              }
            }
          }
        })
      )
    );

    // After creating patients, connect them to clinics
    await Promise.all(
      patients.map(patient =>
        prisma.user.update({
          where: { id: patient.userId },
          data: {
            Clinic: {
              connect: { id: clinic1.id }
            }
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
      Array.from({ length: 5 }).map(async (_, index) => {
        const appointmentDate = faker.date.future();
        const timeString = appointmentDate.toLocaleTimeString('en-US', { 
          hour12: false, 
          hour: '2-digit', 
          minute: '2-digit' 
        });
        
        // Select random doctor and patient from arrays
        const doctor = doctors[Math.floor(Math.random() * doctors.length)];
        const patient = patients[Math.floor(Math.random() * patients.length)];
        
        return prisma.appointment.create({
          data: {
            doctor: {
              connect: { id: doctor.id }
            },
            patient: {
              connect: { id: patient.id }
            },
            location: {
              connect: { id: location1.id }
            },
            clinic: {
              connect: { id: clinic1.id }
            },
            date: appointmentDate,
            time: timeString,
            duration: faker.number.int({ min: 15, max: 60 }),
            type: AppointmentType.IN_PERSON,
            status: AppointmentStatus.SCHEDULED,
            notes: faker.lorem.sentence(),
            user: {
              connect: { id: patient.userId }
            }
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

    console.log('Database seeding completed successfully!');
    console.log('SuperAdmin credentials: admin@example.com / admin123');
    console.log('Created clinics:');
    console.log('1. Ayurveda Wellness Center');

  } catch (error) {
    console.error('Error during database seeding:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

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

main();
