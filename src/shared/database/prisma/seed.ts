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
    const location1 = await prisma.clinicLocation.create({
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
        locationId: generateLocationId()
      }
    });

    const location2 = await prisma.clinicLocation.create({
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
        locationId: generateLocationId()
      }
    });

    const location3 = await prisma.clinicLocation.create({
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
        locationId: generateLocationId()
      }
    });

    // Vishwamurthi Ayurvedalay Locations
    const location4 = await prisma.clinicLocation.create({
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
        locationId: generateLocationId()
      }
    });

    const location5 = await prisma.clinicLocation.create({
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
        locationId: generateLocationId()
      }
    });

    const location6 = await prisma.clinicLocation.create({
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
        locationId: generateLocationId()
      }
    });

    // Group locations by clinic for later use
    const clinic1Locations = [location1, location2, location3];
    const clinic2Locations = [location4, location5, location6];

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
    const therapies1 = await Promise.all(
      Array(SEED_COUNT).fill(null).map(() => 
        prisma.therapy.create({
          data: {
            name: faker.commerce.productName(),
            description: faker.commerce.productDescription(),
            duration: faker.number.int({ min: 30, max: 120 }),
            clinicId: clinic1.id
          }
        })
      )
    );

    const therapies2 = await Promise.all(
      Array(SEED_COUNT).fill(null).map(() => 
        prisma.therapy.create({
          data: {
            name: faker.commerce.productName(),
            description: faker.commerce.productDescription(),
            duration: faker.number.int({ min: 30, max: 120 }),
            clinicId: clinic2.id
          }
        })
      )
    );

    // Create Appointments
    console.log('Creating appointments...');
    const appointments = await Promise.all(
      Array.from({ length: 10 }).map(async (_, index) => {
        const appointmentDate = faker.date.future();
        const timeString = appointmentDate.toLocaleTimeString('en-US', { 
          hour12: false, 
          hour: '2-digit', 
          minute: '2-digit' 
        });
        
        // Select random doctor and patient from arrays
        const doctor = doctors[Math.floor(Math.random() * doctors.length)];
        const patient = patients[Math.floor(Math.random() * patients.length)];
        const isFirstClinic = index % 2 === 0;
        const clinicId = isFirstClinic ? clinic1.id : clinic2.id;
        
        // Select random location from the appropriate clinic
        const clinicLocations = isFirstClinic ? clinic1Locations : clinic2Locations;
        const randomLocationIndex = Math.floor(Math.random() * clinicLocations.length);
        const locationId = clinicLocations[randomLocationIndex].id;
        
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

    // Create Payments
    console.log('Creating payments...');
    await Promise.all(
      appointments.map(appointment => 
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
      )
    );

    // Create Queues
    console.log('Creating queues...');
    await Promise.all(
      appointments.map((appointment, index) => 
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
    );

    // Create Prescriptions and PrescriptionItems
    console.log('Creating prescriptions...');
    await Promise.all(
      Array(SEED_COUNT).fill(null).map(() => {
        const patient = faker.helpers.arrayElement(patients);
        const doctor = faker.helpers.arrayElement(doctors);
        const clinic = faker.helpers.arrayElement([clinic1, clinic2]);
        const clinicMedicines = medicines.filter(m => m.clinicId === clinic.id);
        
        return prisma.prescription.create({
          data: {
            patientId: patient.id,
            doctorId: doctor.id,
            notes: faker.lorem.paragraph(),
            clinicId: clinic.id,
            items: {
              create: Array(3).fill(null).map(() => ({
                medicineId: faker.helpers.arrayElement(clinicMedicines).id,
                dosage: faker.number.int({ min: 1, max: 3 }) + " times daily",
                frequency: "Every " + faker.number.int({ min: 4, max: 12 }) + " hours",
                duration: faker.number.int({ min: 3, max: 30 }) + " days",
                clinicId: clinic.id
              }))
            }
          }
        });
      })
    );

    // Create HealthRecords
    console.log('Creating health records...');
    await Promise.all(
      Array(SEED_COUNT).fill(null).map(() => {
        const patient = faker.helpers.arrayElement(patients);
        const doctor = faker.helpers.arrayElement(doctors);
        const clinic = faker.helpers.arrayElement([clinic1, clinic2]);
        
        return prisma.healthRecord.create({
          data: {
            recordType: faker.helpers.arrayElement(Object.values(HealthRecordType)),
            report: faker.lorem.paragraph(),
            fileUrl: faker.internet.url(),
            clinicId: clinic.id,
            patientId: patient.id,
            doctorId: doctor.id
          }
        });
      })
    );

    // Create Reviews
    console.log('Creating reviews...');
    await Promise.all(
      Array(SEED_COUNT).fill(null).map(() => {
        const patient = faker.helpers.arrayElement(patients);
        const doctor = faker.helpers.arrayElement(doctors);
        const clinic = faker.helpers.arrayElement([clinic1, clinic2]);
        
        return prisma.review.create({
          data: {
            rating: faker.number.int({ min: 1, max: 5 }),
            comment: faker.lorem.paragraph(),
            clinicId: clinic.id,
            patientId: patient.id,
            doctorId: doctor.id
          }
        });
      })
    );

    // Create Products
    console.log('Creating products...');
    await Promise.all([
      ...Array(SEED_COUNT).fill(null).map(() => 
        prisma.product.create({
          data: {
            name: faker.commerce.productName(),
            description: faker.commerce.productDescription(),
            price: parseFloat(faker.commerce.price()),
            category: faker.commerce.department(),
            stock: faker.number.int({ min: 0, max: 100 }),
            clinicId: clinic1.id
          }
        })
      ),
      ...Array(SEED_COUNT).fill(null).map(() => 
        prisma.product.create({
          data: {
            name: faker.commerce.productName(),
            description: faker.commerce.productDescription(),
            price: parseFloat(faker.commerce.price()),
            category: faker.commerce.department(),
            stock: faker.number.int({ min: 0, max: 100 }),
            clinicId: clinic2.id
          }
        })
      )
    ]);

    // Create Notifications
    console.log('Creating notifications...');
    await Promise.all(
      Array(SEED_COUNT).fill(null).map(() => 
        prisma.notification.create({
          data: {
            userId: faker.helpers.arrayElement(users).id,
            type: faker.helpers.arrayElement(Object.values(NotificationType)),
            message: faker.lorem.sentence(),
            status: faker.helpers.arrayElement(Object.values(NotificationStatus)),
            clinicId: faker.helpers.arrayElement([clinic1.id, clinic2.id])
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
            device: faker.helpers.arrayElement(['Web', 'Mobile', 'Tablet']),
            clinicId: faker.helpers.arrayElement([clinic1.id, clinic2.id])
          }
        })
      )
    );

    console.log('Seeding complete!');
    console.log('SuperAdmin credentials: admin@example.com / admin123');
    console.log('Created clinics:');
    console.log('1. Aadesh Ayurvedalay');
    console.log('2. Shri Vishwamurthi Ayurvedalay');
  } catch (error) {
    console.error('Error during seeding:', error);
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
    await prisma.auditLog.deleteMany({});
    await prisma.notification.deleteMany({});
    await prisma.prescriptionItem.deleteMany({});
    await prisma.prescription.deleteMany({});
    await prisma.review.deleteMany({});
    await prisma.healthRecord.deleteMany({});
    await prisma.queue.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.appointment.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.medicine.deleteMany({});
    await prisma.therapy.deleteMany({});
    await prisma.doctorClinic.deleteMany({});
    await prisma.doctor.deleteMany({});
    await prisma.receptionist.deleteMany({});
    await prisma.patient.deleteMany({});
    await prisma.clinicAdmin.deleteMany({});
    await prisma.clinicLocation.deleteMany({});
    await prisma.clinic.deleteMany({}); // Delete clinics before users due to createdBy foreign key
    await prisma.superAdmin.deleteMany({});
    await prisma.user.deleteMany({});
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
