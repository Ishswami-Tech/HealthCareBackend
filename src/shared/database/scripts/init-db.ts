import { getPrismaClient } from '../prisma/prisma.types';

const prisma = getPrismaClient();

export async function initDatabase() {
  try {
    // Test the connection
    await prisma.$connect();
    console.log('Database connection successful');

    // Your initialization logic here
    console.log('Database initialized');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

// Allow running directly
if (require.main === module) {
  initDatabase()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

