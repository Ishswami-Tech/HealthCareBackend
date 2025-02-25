import { PrismaClient } from '@prisma/client';

export async function initDatabase() {
  try {
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });

    console.log('Environment:', process.env.NODE_ENV);
    console.log('Using Database URL:', process.env.DATABASE_URL);

    // Test the connection
    await prisma.$queryRaw`SELECT 1`;
    
    // Create schema if it doesn't exist
    await prisma.$executeRaw`CREATE SCHEMA IF NOT EXISTS public`;

    console.log('Database initialized successfully');
    await prisma.$disconnect();
    return true;
  } catch (error) {
    console.error('Database initialization failed:', error);
    console.log('Current DATABASE_URL:', process.env.DATABASE_URL);
    throw error;
  }
}

