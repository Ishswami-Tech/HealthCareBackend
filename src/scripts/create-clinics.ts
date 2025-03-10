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
      address: '123 Ayurveda Street, Mumbai, Maharashtra',
      phone: '+919876543210',
      app_name: 'aadeshayurvedalay',
      createdBy: superAdmin.userId
    });

    // Create Shri Vishwamurthi Ayurvedalay clinic
    console.log('Creating Shri Vishwamurthi Ayurvedalay clinic...');
    const vishwamurthiClinic = await clinicService.createClinic({
      name: 'Shri Vishwamurthi Ayurvedalay',
      address: '456 Wellness Road, Bangalore, Karnataka',
      phone: '+919876543211',
      app_name: 'vishwamurthiayurvedalay',
      createdBy: superAdmin.userId
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