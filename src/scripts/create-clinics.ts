import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ClinicService } from '../services/clinic/clinic.service';

async function createClinics() {
  // Create a NestJS application context
  const app = await NestFactory.createApplicationContext(AppModule);
  
  try {
    // Get the ClinicService from the application context
    const clinicService = app.get(ClinicService);
    
    // Find SuperAdmin user
    const prisma = app.get('PrismaService');
    const superAdmin = await prisma.superAdmin.findFirst();
    
    if (!superAdmin) {
      console.error('No SuperAdmin found. Please create a SuperAdmin user first.');
      return;
    }

    // Create Aadesh Ayurvedalay clinic
    console.log('Creating Aadesh Ayurvedalay clinic...');
    const aadeshClinic = await clinicService.createClinic({
      name: 'Aadesh Ayurvedalay',
      address: '123 Main St, Mumbai, India',
      phone: '+91 9876543210',
      email: 'aadeshayurvedalay@example.com',
      createdBy: superAdmin.id,
    });

    // Create Shri Vishwamurthi Ayurvedalay clinic
    console.log('Creating Shri Vishwamurthi Ayurvedalay clinic...');
    const vishwamurthiClinic = await clinicService.createClinic({
      name: 'Vishwamurthi Ayurvedalay',
      address: '456 Oak St, Delhi, India',
      phone: '+91 9876543211',
      email: 'vishwamurthiayurvedalay@example.com',
      createdBy: superAdmin.id,
    });

    console.log('Clinics created successfully:');
    console.log('1. Aadesh Ayurvedalay:', aadeshClinic.id);
    console.log('2. Shri Vishwamurthi Ayurvedalay:', vishwamurthiClinic.id);
  } catch (error) {
    console.error('Error creating clinics:', error);
  } finally {
    await app.close();
  }
}

createClinics()
  .then(() => console.log('Script completed'))
  .catch(error => console.error('Script failed:', error)); 