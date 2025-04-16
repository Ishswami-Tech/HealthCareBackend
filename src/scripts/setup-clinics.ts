import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AuthService } from '../services/auth/services/auth.service';
import { ClinicService } from '../services/clinic/clinic.service';
import { Role, Gender } from '@prisma/client';

async function setupClinics() {
  // Create a NestJS application context
  const app = await NestFactory.createApplicationContext(AppModule);
  
  try {
    // Get the services from the application context
    const authService = app.get(AuthService);
    const clinicService = app.get(ClinicService);
    const prisma = app.get('PrismaService');
    
    // Step 1: Create SuperAdmin if it doesn't exist
    console.log('Step 1: Checking for SuperAdmin...');
    let superAdmin = await prisma.superAdmin.findFirst({
      include: { user: true }
    });

    if (!superAdmin) {
      console.log('No SuperAdmin found. Creating one...');
      
      // Create a new SuperAdmin user
      const superAdminData = {
        email: 'superadmin@healthcare.com',
        password: 'SuperAdmin@123',
        name: 'Super Admin',
        firstName: 'Super',
        lastName: 'Admin',
        age: 30,
        role: Role.SUPER_ADMIN,
        gender: Gender.MALE,
        phone: '+919876543200',
      };

      const superAdminUser = await authService.register(superAdminData);
      
      // Create SuperAdmin record
      superAdmin = await prisma.superAdmin.create({
        data: {
          userId: superAdminUser.id,
        },
        include: { user: true }
      });

      console.log('SuperAdmin created successfully:', superAdminUser.email);
    } else {
      console.log('SuperAdmin already exists:', superAdmin.user.email);
    }

    // Step 2: Create Clinics
    console.log('\nStep 2: Creating Clinics...');
    
    // Create Aadesh Ayurvedalay clinic
    console.log('Creating Aadesh Ayurvedalay clinic...');
    try {
      const aadeshClinic = await clinicService.createClinic({
        name: 'Aadesh Ayurvedalay',
        address: '123 Main St, Mumbai, India',
        phone: '+91 9876543210',
        email: 'aadeshayurvedalay@example.com',
        createdBy: superAdmin.id,
      });
      console.log('Aadesh Ayurvedalay clinic created successfully:', aadeshClinic.id);
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('Aadesh Ayurvedalay clinic already exists');
      } else {
        throw error;
      }
    }

    // Create Shri Vishwamurthi Ayurvedalay clinic
    console.log('Creating Shri Vishwamurthi Ayurvedalay clinic...');
    try {
      const vishwamurthiClinic = await clinicService.createClinic({
        name: 'Vishwamurthi Ayurvedalay',
        address: '456 Oak St, Delhi, India',
        phone: '+91 9876543211',
        email: 'vishwamurthiayurvedalay@example.com',
        createdBy: superAdmin.id,
      });
      console.log('Shri Vishwamurthi Ayurvedalay clinic created successfully:', vishwamurthiClinic.id);
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('Shri Vishwamurthi Ayurvedalay clinic already exists');
      } else {
        throw error;
      }
    }

    console.log('\nSetup completed successfully!');
  } catch (error) {
    console.error('Error during setup:', error);
  } finally {
    await app.close();
  }
}

setupClinics()
  .then(() => console.log('Script completed'))
  .catch(error => console.error('Script failed:', error)); 