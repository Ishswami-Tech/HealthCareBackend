import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AuthService } from '../services/auth/services/auth.service';
import { Role, Gender } from '@prisma/client';

async function createSuperAdmin() {
  // Create a NestJS application context
  const app = await NestFactory.createApplicationContext(AppModule);
  
  try {
    // Get the AuthService from the application context
    const authService = app.get(AuthService);
    const prisma = app.get('PrismaService');
    
    // Check if a SuperAdmin already exists
    const existingSuperAdmin = await prisma.user.findFirst({
      where: { role: Role.SUPER_ADMIN }
    });

    if (existingSuperAdmin) {
      console.log('SuperAdmin already exists:', existingSuperAdmin.email);
      return;
    }

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

    console.log('Creating SuperAdmin user...');
    const superAdmin = await authService.register(superAdminData);
    
    // Create SuperAdmin record
    await prisma.superAdmin.create({
      data: {
        userId: superAdmin.id,
      },
    });

    console.log('SuperAdmin created successfully:', superAdmin.email);
  } catch (error) {
    console.error('Error creating SuperAdmin:', error);
  } finally {
    await app.close();
  }
}

createSuperAdmin()
  .then(() => console.log('Script completed'))
  .catch(error => console.error('Script failed:', error)); 