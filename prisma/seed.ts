import { PrismaClient } from '@prisma/client';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

async function main() {
  // First, clean the database
  await prisma.user.deleteMany({});

  // Reset the ID sequence
  await prisma.$executeRaw`ALTER SEQUENCE users_id_seq RESTART WITH 1;`;

  // Create 50 users with faker data
  const users = Array.from({ length: 50 }, () => ({
    email: faker.internet.email(),
    name: faker.person.fullName(),
    age: faker.number.int({ min: 18, max: 80 }),
    city: faker.location.city(),
  }));

  console.log('Starting to seed database...');

  for (const user of users) {
    await prisma.user.create({ data: user });
  }

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
