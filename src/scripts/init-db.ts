import { PrismaClient } from "@prisma/client";

async function initDatabase() {
  const prisma = new PrismaClient();

  try {
    // Run migrations
    await prisma.$executeRaw`CREATE SCHEMA IF NOT EXISTS public`;

    // Verify connection
    await prisma.$connect();

    console.log("Database initialized successfully");
  } catch (error) {
    console.error("Database initialization failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

export default initDatabase;
