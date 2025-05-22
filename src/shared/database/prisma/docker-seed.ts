import { PrismaClient } from '@prisma/client';
import { faker } from "@faker-js/faker";
import * as bcrypt from 'bcryptjs';

// Create a new PrismaClient instance
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Starting database seeding for Docker setup...');

    // Check if SuperAdmin user already exists
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
          role: 'SUPER_ADMIN',
          gender: 'MALE',
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

    // Check if clinics already exist
    console.log('Checking if clinics exist...');
    const aadeshClinicExists = await prisma.clinic.findFirst({
      where: {
        name: 'Aadesh Ayurvedalay'
      }
    });

    const vishwamurthiClinicExists = await prisma.clinic.findFirst({
      where: {
        name: 'Shri Vishwamurthi Ayurvedalay'
      }
    });

    let aadeshClinic;
    let vishwamurthiClinic;

    if (!aadeshClinicExists) {
      console.log('Creating Aadesh Ayurvedalay clinic...');
      // Create Aadesh Ayurvedalay clinic
      aadeshClinic = await prisma.clinic.create({
        data: {
          name: 'Aadesh Ayurvedalay',
          address: 'Pune, Maharashtra',
          phone: '1234567890',
          email: 'contact@aadesh.com',
          app_name: 'aadesh_app',
          db_connection_string: process.env.DATABASE_URL || 'postgresql://postgres:postgres@postgres:5432/healthcareapp?schema=public',
          databaseName: 'aadesh_clinic_db',
          clinicId: 'CL0001',
          subdomain: 'aadesh',
          isActive: true,
          createdBy: superAdminUser.id,
        }
      });
      console.log('Aadesh Ayurvedalay clinic created successfully.');

      // Create a main location for Aadesh clinic
      await prisma.clinicLocation.create({
        data: {
          name: 'Main Branch',
          address: 'Pune, Maharashtra',
          city: 'Pune',
          state: 'Maharashtra',
          country: 'India',
          zipCode: '411001',
          phone: '1234567890',
          email: 'location@aadesh.com',
          clinicId: aadeshClinic.id,
          locationId: 'LOC0001',
          isActive: true,
        }
      });
    } else {
      console.log('Aadesh Ayurvedalay clinic already exists, skipping creation.');
      aadeshClinic = aadeshClinicExists;
    }

    if (!vishwamurthiClinicExists) {
      console.log('Creating Shri Vishwamurthi Ayurvedalay clinic...');
      // Create Shri Vishwamurthi Ayurvedalay clinic
      vishwamurthiClinic = await prisma.clinic.create({
        data: {
          name: 'Shri Vishwamurthi Ayurvedalay',
          address: 'Mumbai, Maharashtra',
          phone: '0987654321',
          email: 'contact@vishwamurthi.com',
          app_name: 'vishwamurthi_app',
          db_connection_string: process.env.DATABASE_URL || 'postgresql://postgres:postgres@postgres:5432/healthcareapp?schema=public',
          databaseName: 'vishwamurthi_clinic_db',
          clinicId: 'CL0002',
          subdomain: 'vishwamurthi',
          isActive: true,
          createdBy: superAdminUser.id,
        }
      });
      console.log('Shri Vishwamurthi Ayurvedalay clinic created successfully.');

      // Create a main location for Vishwamurthi clinic
      await prisma.clinicLocation.create({
        data: {
          name: 'Main Branch',
          address: 'Mumbai, Maharashtra',
          city: 'Mumbai',
          state: 'Maharashtra',
          country: 'India',
          zipCode: '400001',
          phone: '0987654321',
          email: 'location@vishwamurthi.com',
          clinicId: vishwamurthiClinic.id,
          locationId: 'LOC0002',
          isActive: true,
        }
      });
    } else {
      console.log('Shri Vishwamurthi Ayurvedalay clinic already exists, skipping creation.');
      vishwamurthiClinic = vishwamurthiClinicExists;
    }

    // Create a clinic admin user for testing
    const adminExists = await prisma.user.findUnique({
      where: {
        email: 'clinicadmin@example.com'
      }
    });

    if (!adminExists) {
      console.log('Creating clinic admin user...');
      const clinicAdmin = await prisma.user.create({
        data: {
          email: 'clinicadmin@example.com',
          password: await bcrypt.hash('admin123', 10),
          name: 'Clinic Admin',
          age: 35,
          firstName: 'Clinic',
          lastName: 'Admin',
          phone: '9876543210',
          role: 'CLINIC_ADMIN',
          gender: 'MALE',
          isVerified: true,
        }
      });

      // Assign the clinic admin to the first clinic
      await prisma.clinicAdmin.create({
        data: {
          userId: clinicAdmin.id,
          clinicId: aadeshClinic.id,
          isOwner: true
        }
      });
      console.log('Clinic admin user created successfully.');
    }

    console.log('Database seeding completed successfully!');
    console.log('SuperAdmin user email: admin@example.com and password: admin123');
    console.log('Clinic Admin user email: clinicadmin@example.com and password: admin123');
    console.log(`Clinics: ${aadeshClinic?.name}, ${vishwamurthiClinic?.name}`);

  } catch (error) {
    console.error('Error during database seeding:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main(); 