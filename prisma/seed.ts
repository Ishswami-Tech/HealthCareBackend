import { PrismaClient, Role, Gender } from "@prisma/client";
import { faker } from "@faker-js/faker";

async function generateUserData(role: Role) {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  return {
    email: faker.internet.email({ firstName, lastName }),
    password: faker.internet.password(),
    name: `${firstName} ${lastName}`,
    age: faker.number.int({ min: 25, max: 70 }),
    firstName,
    lastName,
    phone: faker.phone.number(),
    role,
    gender: faker.helpers.arrayElement([
      Gender.MALE,
      Gender.FEMALE,
      Gender.OTHER,
    ]),
    dateOfBirth: faker.date.past({ years: 50 }),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    country: faker.location.country(),
    zipCode: faker.location.zipCode(),
    isVerified: faker.datatype.boolean(),
    lastLogin: faker.date.recent(),
  };
}

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log("Starting database seed...");

    // Clear existing data
    await prisma.$transaction([
      prisma.auditLog.deleteMany(),
      prisma.notification.deleteMany(),
      prisma.doctor.deleteMany(),
      prisma.patient.deleteMany(),
      prisma.receptionist.deleteMany(),
      prisma.clinicAdmin.deleteMany(),
      prisma.superAdmin.deleteMany(),
      prisma.user.deleteMany(),
    ]);

    const roles = [
      Role.SUPER_ADMIN,
      Role.CLINIC_ADMIN,
      Role.DOCTOR,
      Role.PATIENT,
      Role.RECEPTIONIST,
    ];

    for (const role of roles) {
      console.log(`Creating ${role} users...`);
      const users = await Promise.all(
        Array.from({ length: 50 }, () => generateUserData(role))
      );

      for (const userData of users) {
        const user = await prisma.user.create({ data: userData });

        // Create role-specific records
        switch (user.role) {
          case Role.DOCTOR:
            await prisma.doctor.create({
              data: {
                userId: user.id,
                specialization: faker.helpers.arrayElement([
                  "Ayurveda",
                  "Panchakarma",
                  "Yoga",
                  "Herbal Medicine",
                ]),
                experience: faker.number.int({ min: 1, max: 30 }),
                qualification: faker.helpers.arrayElement([
                  "BAMS",
                  "MD Ayurveda",
                  "PhD Ayurveda",
                ]),
                licenseNumber: faker.string.alphanumeric(10).toUpperCase(),
              },
            });
            break;

          case Role.PATIENT:
            await prisma.patient.create({
              data: {
                userId: user.id,

                emergencyContact: faker.phone.number(),
                allergies: faker.helpers.arrayElements(
                  ["Peanuts", "Dairy", "Gluten", "None"],
                  { min: 0, max: 2 }
                ),
              },
            });
            break;

          case Role.RECEPTIONIST:
            await prisma.receptionist.create({
              data: {
                userId: user.id,
                shift: faker.helpers.arrayElement(["MORNING", "EVENING"]),
              },
            });
            break;

          case Role.CLINIC_ADMIN:
            await prisma.clinicAdmin.create({
              data: {
                userId: user.id,
                department: faker.helpers.arrayElement([
                  "Operations",
                  "Management",
                  "Finance",
                ]),
              },
            });
            break;

          case Role.SUPER_ADMIN:
            await prisma.superAdmin.create({
              data: {
                userId: user.id,
                accessLevel: faker.number.int({ min: 1, max: 5 }),
              },
            });
            break;
        }
      }
      console.log(`Created ${role} users successfully`);
    }

    console.log("Database seeding completed successfully");
  } catch (error) {
    console.error("Error seeding database:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
