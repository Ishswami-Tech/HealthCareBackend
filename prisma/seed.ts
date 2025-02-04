import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = Array.from({ length: 10 }, (_, i) => ({
    email: `user${i + 1}@example.com`,
    name: `User ${i + 1}`,
    age: 20 + i,
    city: `City ${i + 1}`,
  }));

  for (const user of users) {
    await prisma.user.create({ data: user });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
