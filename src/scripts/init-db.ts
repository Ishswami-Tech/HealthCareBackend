import { PrismaClient } from '@prisma/client';
import { faker } from '@faker-js/faker';

async function initDatabase() {
  const prisma = new PrismaClient();

  try {
    const count = await prisma.user.count();
    if (count === 0) {
      const users = Array.from({ length: 50 }, () => ({
        email: faker.internet.email(),
        name: faker.person.fullName(),
        age: faker.number.int({ min: 18, max: 80 }),
        city: faker.location.city(),
      }));

      for (const user of users) {
        await prisma.user.create({ data: user });
      }
      console.log('Database initialized with 50 users');
    }
  } catch (error) {
    console.error('Database initialization failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

export default initDatabase;
