import { PrismaClient, Role, Gender, Prakriti, Dosha } from '@prisma/client';
import { faker } from "@faker-js/faker";
import {
  AppointmentStatus,
  PaymentStatus,
  PaymentMethod,
  AppointmentType,
  MedicineType,
  QueueStatus,
  NotificationType,
  NotificationStatus,
  HealthRecordType,
  getPrismaClient
} from './prisma.types';
import * as bcrypt from 'bcryptjs';

const SEED_COUNT = 50;
const prisma = getPrismaClient();

let userIdCounter = 1;
const generateUserId = () => `UID${String(userIdCounter++).padStart(6, '0')}`;

async function main() {
  try {
    await waitForDatabase();
    
    console.log('Cleaning database...');
    await cleanDatabase();
    
    console.log('Starting comprehensive database seeding...');

    // ===== SUPER ADMIN CREATION =====
    console.log('Checking if SuperAdmin user exists...');
    let superAdminUser = await prisma.user.findUnique({
      where: {
        email: 'admin@example.com'
      }
    });

    if (!superAdminUser) {
      // Create a SuperAdmin user
      console.log('Creating SuperAdmin user...');
      const hashedPassword = await bcrypt.hash('admin123', 10);
      
      superAdminUser = await prisma.user.create({
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

      // Create SuperAdmin record
      await prisma.superAdmin.create({
        data: {
          userId: superAdminUser.id
        }
      });
      console.log('SuperAdmin user created successfully.');
    } else {
      console.log('SuperAdmin user already exists, skipping creation.');
    }

    // ===== CLINIC CREATION =====
    console.log('Checking if clinics exist...');
    
    // Aadesh Ayurvedalay Clinic
    let aadeshClinic = await prisma.clinic.findFirst({
      where: {
        name: 'Aadesh Ayurvedalay'
      }
    });

    if (!aadeshClinic) {
      console.log('Creating Aadesh Ayurvedalay clinic...');
      aadeshClinic = await prisma.clinic.create({
        data: {
          name: 'Aadesh Ayurvedalay',
          address: 'Bangalore Road, Bangalore',
          phone: '+919876543210',
          email: 'info@aadeshayurvedalay.in',
          app_name: 'aadesh',
          db_connection_string: 'postgresql://postgres:postgres@localhost:5432/clinic_aadesh_db',
          databaseName: 'clinic_aadesh_db',
          createdBy: superAdminUser.id,
          databaseStatus: 'ACTIVE',
          isActive: true,
        } as any,
      });
      
      console.log(`Aadesh Ayurvedalay clinic created with ID: ${aadeshClinic.id}`);
    } else {
      console.log('Aadesh Ayurvedalay clinic already exists, skipping creation.');
    }

    // Shri Vishwamurthi Ayurvedalay Clinic
    let vishwamurthiClinic = await prisma.clinic.findFirst({
      where: {
        name: 'Shri Vishwamurthi Ayurvedalay'
      }
    });

    if (!vishwamurthiClinic) {
      console.log('Creating Shri Vishwamurthi Ayurvedalay clinic...');
      vishwamurthiClinic = await prisma.clinic.create({
        data: {
          name: 'Vishwamurthi Ayurvedalay',
          address: 'MG Road, Mumbai',
          phone: '+919876543211',
          email: 'info@vishwamurthiayurvedalay.in',
          app_name: 'vishwamurthi',
          db_connection_string: 'postgresql://postgres:postgres@localhost:5432/clinic_vishwamurthi_db',
          databaseName: 'clinic_vishwamurthi_db',
          createdBy: superAdminUser.id,
          databaseStatus: 'ACTIVE',
          isActive: true,
        } as any,
      });
      
      console.log(`Shri Vishwamurthi Ayurvedalay clinic created with ID: ${vishwamurthiClinic.id}`);
    } else {
      console.log('Shri Vishwamurthi Ayurvedalay clinic already exists, skipping creation.');
    }

    // ===== SAMPLE USERS CREATION =====
    // Create a sample doctor
    const doctorExists = await prisma.user.findUnique({
      where: {
        email: 'doctor@example.com'
      }
    });

    if (!doctorExists) {
      console.log('Creating sample doctor...');
      const hashedPassword = await bcrypt.hash('doctor123', 10);
      
      const doctorUser = await prisma.user.create({
        data: {
          email: 'doctor@example.com',
          password: hashedPassword,
          name: 'Dr. John Doe',
          age: 40,
          firstName: 'John',
          lastName: 'Doe',
          phone: '1122334455',
          role: Role.DOCTOR,
          gender: Gender.MALE,
          isVerified: true,
        }
      });

      // Create doctor record
      await prisma.doctor.create({
        data: {
          userId: doctorUser.id,
          specialization: 'General Physician',
          qualification: 'MBBS, MD',
          experience: 10,
        }
      });
      console.log('Sample doctor created successfully.');
    }

    // Create a sample patient
    const patientExists = await prisma.user.findUnique({
      where: {
        email: 'patient@example.com'
      }
    });

    if (!patientExists) {
      console.log('Creating sample patient...');
      const hashedPassword = await bcrypt.hash('patient123', 10);
      
      const patientUser = await prisma.user.create({
        data: {
          email: 'patient@example.com',
          password: hashedPassword,
          name: 'Jane Smith',
          age: 30,
          firstName: 'Jane',
          lastName: 'Smith',
          phone: '9988776655',
          role: Role.PATIENT,
          gender: Gender.FEMALE,
          isVerified: true,
        }
      });

      // Create patient record
      await prisma.patient.create({
        data: {
          userId: patientUser.id,
          prakriti: Prakriti.VATA,
          dosha: Dosha.VATA,
          createdAt: new Date()
        }
      });
      console.log('Sample patient created successfully.');
    }

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

    // Create ClinicAdmins
    console.log('Creating clinic admins...');
    const clinicAdminUsers = users.filter(u => u.role === Role.CLINIC_ADMIN);
    await Promise.all(
      clinicAdminUsers.map((user, index) => 
        prisma.clinicAdmin.create({
          data: {
            userId: user.id,
            clinicId: faker.helpers.arrayElement([aadeshClinic, vishwamurthiClinic]).id
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
            clinicId: faker.helpers.arrayElement([aadeshClinic, vishwamurthiClinic]).id,
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
            clinicId: faker.helpers.arrayElement([aadeshClinic, vishwamurthiClinic]).id
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

    console.log('Database seeding completed successfully!');
    console.log('SuperAdmin credentials: admin@example.com / admin123');
    console.log('Doctor credentials: doctor@example.com / doctor123');
    console.log('Patient credentials: patient@example.com / patient123');

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
