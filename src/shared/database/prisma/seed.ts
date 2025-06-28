import { PrismaClient } from '@prisma/client';
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
import { Role, Gender, Prakriti, Dosha, AppointmentStatus, AppointmentType } from './prisma.types';

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
        userid: generateUserId()
      }
    });

    await prisma.superAdmin.create({
      data: {
        userId: superAdminUser.id
      }
    });

    // ===== CLINIC CREATION =====
    console.log('Creating clinics...');
    
    // Aadesh Ayurvedalay
    const clinic1 = await prisma.clinic.create({
      data: {
        name: 'Aadesh Ayurvedalay',
        address: 'Pune, Maharashtra',
        phone: '+91-9876543210',
        email: 'contact@aadesh.com',
        app_name: 'aadesh_ayurvedalay',
        db_connection_string: process.env.DATABASE_URL || 'postgresql://postgres:postgres@postgres:5432/userdb?schema=public',
        databaseName: 'userdb',
        createdByUser: {
          connect: { id: superAdminUser.id }
        },
        clinicId: 'CL0001',
        subdomain: 'aadesh',
        isActive: true
      }
    });

    // Shri Vishwamurthi Ayurvedalay
    const clinic2 = await prisma.clinic.create({
      data: {
        name: 'Shri Vishwamurthi Ayurvedalay',
        address: 'Mumbai, Maharashtra',
        phone: '+91-8765432109',
        email: 'contact@vishwamurthi.com',
        app_name: 'vishwamurthi_ayurvedalay',
        db_connection_string: process.env.DATABASE_URL || 'postgresql://postgres:postgres@postgres:5432/userdb?schema=public',
        databaseName: 'userdb',
        createdByUser: {
          connect: { id: superAdminUser.id }
        },
        clinicId: 'CL0002',
        subdomain: 'vishwamurthi',
        isActive: true
      }
    });

    // Create clinic locations
    console.log('Creating clinic locations...');
    // Aadesh Ayurvedalay Locations
    const clinic1Locations = await Promise.all([
      prisma.clinicLocation.create({
        data: {
          name: 'Aadesh Main Branch',
          address: 'Koregaon Park, Pune',
          city: 'Pune',
          state: 'Maharashtra',
          country: 'India',
          zipCode: '411001',
          phone: '+91-9876543210',
          email: 'main@aadesh.com',
          clinicId: clinic1.id,
          locationId: generateLocationId(),
          isActive: true
        }
      }),
      prisma.clinicLocation.create({
        data: {
          name: 'Aadesh North Branch',
          address: 'Baner Road, Pune',
          city: 'Pune',
          state: 'Maharashtra',
          country: 'India',
          zipCode: '411045',
          phone: '+91-9876543211',
          email: 'north@aadesh.com',
          clinicId: clinic1.id,
          locationId: generateLocationId(),
          isActive: true
        }
      }),
      prisma.clinicLocation.create({
        data: {
          name: 'Aadesh South Branch',
          address: 'Sinhagad Road, Pune',
          city: 'Pune',
          state: 'Maharashtra',
          country: 'India',
          zipCode: '411041',
          phone: '+91-9876543212',
          email: 'south@aadesh.com',
          clinicId: clinic1.id,
          locationId: generateLocationId(),
          isActive: true
        }
      })
    ]);

    // Vishwamurthi Ayurvedalay Locations
    const clinic2Locations = await Promise.all([
      prisma.clinicLocation.create({
        data: {
          name: 'Vishwamurthi Main Branch',
          address: 'Juhu, Mumbai',
          city: 'Mumbai',
          state: 'Maharashtra',
          country: 'India',
          zipCode: '400049',
          phone: '+91-8765432109',
          email: 'main@vishwamurthi.com',
          clinicId: clinic2.id,
          locationId: generateLocationId(),
          isActive: true
        }
      }),
      prisma.clinicLocation.create({
        data: {
          name: 'Vishwamurthi Andheri Branch',
          address: 'Andheri East, Mumbai',
          city: 'Mumbai',
          state: 'Maharashtra',
          country: 'India',
          zipCode: '400069',
          phone: '+91-8765432108',
          email: 'andheri@vishwamurthi.com',
          clinicId: clinic2.id,
          locationId: generateLocationId(),
          isActive: true
        }
      }),
      prisma.clinicLocation.create({
        data: {
          name: 'Vishwamurthi Powai Branch',
          address: 'Powai, Mumbai',
          city: 'Mumbai',
          state: 'Maharashtra',
          country: 'India',
          zipCode: '400076',
          phone: '+91-8765432107',
          email: 'powai@vishwamurthi.com',
          clinicId: clinic2.id,
          locationId: generateLocationId(),
          isActive: true
        }
      })
    ]);

    // Create a default clinic admin
    console.log('Creating default clinic admin...');
    const clinicAdminUser = await prisma.user.create({
      data: {
        email: 'clinicadmin@example.com',
        password: await bcrypt.hash('admin123', 10),
        name: 'Clinic Admin',
        age: 35,
        firstName: 'Clinic',
        lastName: 'Admin',
        phone: '9876543210',
        role: Role.CLINIC_ADMIN,
        gender: Gender.MALE,
        isVerified: true,
        userid: generateUserId()
      }
    });

    await prisma.clinicAdmin.create({
      data: {
        userId: clinicAdminUser.id,
        clinicId: clinic1.id,
        isOwner: true
      }
    });

    // Create Users with different roles
    console.log('Creating users...');
    const users = await Promise.all([
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
            userid: generateUserId()
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
            userid: generateUserId()
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
            userid: generateUserId()
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
            userid: generateUserId()
          }
        })
      )
    ]);

    // Create ClinicAdmins with clinic associations
    console.log('Creating clinic admins...');
    const clinicAdminUsers = users.filter(u => u.role === Role.CLINIC_ADMIN);
    await Promise.all(
      clinicAdminUsers.map((user, index) => {
        const clinicId = index % 2 === 0 ? clinic1.id : clinic2.id;
        return prisma.clinicAdmin.create({
          data: {
            userId: user.id,
            clinicId: clinicId,
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
    
    // Prepare doctor-clinic relationships data - one relationship per doctor per clinic
    const doctorClinicData = doctors.flatMap(doctor => [
      // Connect doctor to Aadesh clinic with a random location
      {
        doctorId: doctor.id,
        clinicId: clinic1.id,
        locationId: clinic1Locations[Math.floor(Math.random() * clinic1Locations.length)].id,
        startTime: faker.date.future(),
        endTime: faker.date.future()
      },
      // Connect doctor to Vishwamurthi clinic with a random location
      {
        doctorId: doctor.id,
        clinicId: clinic2.id,
        locationId: clinic2Locations[Math.floor(Math.random() * clinic2Locations.length)].id,
        startTime: faker.date.future(),
        endTime: faker.date.future()
      }
    ]);

    // Create doctor-clinic relationships in batches to handle duplicates
    for (const data of doctorClinicData) {
      try {
        await prisma.doctorClinic.create({
          data
        });
      } catch (error) {
        // Skip if relationship already exists
        if (error.code !== 'P2002') {
          throw error;
        }
      }
    }

    // Create Receptionists with clinic associations
    console.log('Creating receptionists...');
    const receptionistUsers = users.filter(u => u.role === Role.RECEPTIONIST);
    
    // First create receptionists without clinic association
    const receptionists = await Promise.all(
      receptionistUsers.map((user) => {
        return prisma.receptionist.create({
          data: {
            userId: user.id,
          }
        });
      })
    );

    // Then create the many-to-many relationships
    console.log('Creating receptionist-clinic relationships...');
    await Promise.all(
      receptionists.map((receptionist, index) => {
        const clinicId = index % 2 === 0 ? clinic1.id : clinic2.id;
        return prisma.receptionistsAtClinic.create({
          data: {
            A: clinicId, // clinic id
            B: receptionist.id // receptionist id
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
      patients.flatMap(patient => [
        prisma.user.update({
          where: { id: patient.userId },
          data: {
            clinics: {
              connect: { id: clinic1.id }
            }
          }
        }),
        prisma.user.update({
          where: { id: patient.userId },
          data: {
            clinics: {
              connect: { id: clinic2.id }
            }
          }
        })
      ])
    );

    // Create sample data only in development environment
    if (process.env.NODE_ENV === 'development') {
      // Create Medicines
      console.log('Creating medicines...');
      const medicines1 = await Promise.all(
        Array(SEED_COUNT).fill(null).map(() => 
          prisma.medicine.create({
            data: {
              name: faker.commerce.productName(),
              ingredients: faker.commerce.productMaterial(),
              properties: faker.commerce.productDescription(),
              dosage: faker.number.int({ min: 1, max: 3 }) + " times daily",
              manufacturer: faker.company.name(),
              type: faker.helpers.arrayElement(Object.values(MedicineType)),
              clinicId: clinic1.id
            }
          })
        )
      );

      const medicines2 = await Promise.all(
        Array(SEED_COUNT).fill(null).map(() => 
          prisma.medicine.create({
            data: {
              name: faker.commerce.productName(),
              ingredients: faker.commerce.productMaterial(),
              properties: faker.commerce.productDescription(),
              dosage: faker.number.int({ min: 1, max: 3 }) + " times daily",
              manufacturer: faker.company.name(),
              type: faker.helpers.arrayElement(Object.values(MedicineType)),
              clinicId: clinic2.id
            }
          })
        )
      );

      const medicines = [...medicines1, ...medicines2];

      // Create Therapies
      console.log('Creating therapies...');
      await Promise.all([
        ...Array(SEED_COUNT).fill(null).map(() => 
          prisma.therapy.create({
            data: {
              name: faker.commerce.productName(),
              description: faker.commerce.productDescription(),
              duration: faker.number.int({ min: 30, max: 120 }),
              clinicId: clinic1.id
            }
          })
        ),
        ...Array(SEED_COUNT).fill(null).map(() => 
          prisma.therapy.create({
            data: {
              name: faker.commerce.productName(),
              description: faker.commerce.productDescription(),
              duration: faker.number.int({ min: 30, max: 120 }),
              clinicId: clinic2.id
            }
          })
        )
      ]);

      // Create sample appointments and related data
      console.log('Creating sample appointments and related data...');
      const appointments = await Promise.all(
        Array.from({ length: 10 }).map(async (_, index) => {
          const appointmentDate = faker.date.future();
          const timeString = appointmentDate.toLocaleTimeString('en-US', { 
            hour12: false, 
            hour: '2-digit', 
            minute: '2-digit' 
          });
          
          const doctor = doctors[Math.floor(Math.random() * doctors.length)];
          const patient = patients[Math.floor(Math.random() * patients.length)];
          const isFirstClinic = index % 2 === 0;
          const clinicId = isFirstClinic ? clinic1.id : clinic2.id;
          const clinicLocations = isFirstClinic ? clinic1Locations : clinic2Locations;
          const locationId = clinicLocations[Math.floor(Math.random() * clinicLocations.length)].id;
          
          return prisma.appointment.create({
            data: {
              doctorId: doctor.id,
              patientId: patient.id,
              locationId: locationId,
              clinicId: clinicId,
              date: appointmentDate,
              time: timeString,
              duration: faker.number.int({ min: 15, max: 60 }),
              type: AppointmentType.IN_PERSON,
              status: AppointmentStatus.SCHEDULED,
              notes: faker.lorem.sentence(),
              userId: patient.userId
            }
          });
        })
      );

      // Create sample payments, queues, prescriptions, etc.
      await Promise.all([
        // Payments
        ...appointments.map(appointment => 
          prisma.payment.create({
            data: {
              amount: faker.number.float({ min: 500, max: 5000 }),
              status: faker.helpers.arrayElement(Object.values(PaymentStatus)),
              method: faker.helpers.arrayElement(Object.values(PaymentMethod)),
              transactionId: faker.string.uuid(),
              clinicId: appointment.clinicId,
              appointmentId: appointment.id
            }
          })
        ),
        // Queues
        ...appointments.map((appointment, index) => 
          prisma.queue.create({
            data: {
              queueNumber: index + 1,
              estimatedWaitTime: faker.number.int({ min: 5, max: 60 }),
              status: faker.helpers.arrayElement(Object.values(QueueStatus)),
              clinicId: appointment.clinicId,
              appointmentId: appointment.id
            }
          })
        )
      ]);
    }

    console.log('Seeding complete!');
    console.log('Default credentials:');
    console.log('SuperAdmin: admin@example.com / admin123');
    console.log('Clinic Admin: clinicadmin@example.com / admin123');
    console.log('Created clinics:');
    console.log('1. Aadesh Ayurvedalay');
    console.log('2. Shri Vishwamurthi Ayurvedalay');

  } catch (error) {
    console.error('Error during seeding:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Function to wait for database to be ready
async function waitForDatabase() {
  let retries = 5;
  while (retries > 0) {
    try {
      await prisma.$connect();
      console.log('Database connection established.');
      return;
    } catch (error) {
      console.log(`Database not ready yet, retrying... (${retries} attempts left)`);
      retries -= 1;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  throw new Error('Failed to connect to database after multiple attempts');
}

// Function to clean up database
async function cleanDatabase() {
  try {
    // Delete records in reverse order of dependencies
    const tables = [
      'auditLog', 'notification', 'prescriptionItem', 'prescription',
      'review', 'healthRecord', 'queue', 'payment', 'appointment',
      'product', 'medicine', 'therapy', 'doctorClinic', 'doctor',
      'receptionist', 'patient', 'clinicAdmin', 'clinicLocation',
      'clinic', 'superAdmin', 'user'
    ];

    for (const table of tables) {
      await prisma[table].deleteMany({});
      console.log(`Cleaned ${table} table`);
    }
  } catch (error) {
    console.error('Error cleaning database:', error);
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
