import {
  PrismaClient,
  Role,
  Gender,
  AppointmentStatus,
  PaymentStatus,
  PaymentMethod,
  QueueStatus,
  HealthRecordType,
  NotificationType,
  NotificationStatus,
  AppointmentType,
  Dosha,
  Prakriti,
  MedicineType,
} from "@prisma/client";
import { faker } from "@faker-js/faker";

const prisma = new PrismaClient();
const SEED_COUNT = 50;

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
    gender: faker.helpers.arrayElement(Object.values(Gender)),
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
  try {
    console.log("Starting database seed...");

    // Clear existing data
    await prisma.$transaction([
      prisma.prescriptionItem.deleteMany(),
      prisma.prescription.deleteMany(),
      prisma.medicine.deleteMany(),
      prisma.auditLog.deleteMany(),
      prisma.healthRecord.deleteMany(),
      prisma.review.deleteMany(),
      prisma.notification.deleteMany(),
      prisma.queue.deleteMany(),
      prisma.payment.deleteMany(),
      prisma.appointment.deleteMany(),
      prisma.therapy.deleteMany(),
      prisma.doctorClinic.deleteMany(),
      prisma.clinic.deleteMany(),
      prisma.doctor.deleteMany(),
      prisma.patient.deleteMany(),
      prisma.receptionist.deleteMany(),
      prisma.clinicAdmin.deleteMany(),
      prisma.superAdmin.deleteMany(),
      prisma.user.deleteMany(),
    ]);

    // Create users and their role-specific records
    const usersByRole = new Map();

    // Create 50 users for each role
    for (const role of Object.values(Role)) {
      const users = await Promise.all(
        Array.from({ length: SEED_COUNT }, async () => {
          const userData = await generateUserData(role);
          return await prisma.user.create({ data: userData });
        })
      );
      usersByRole.set(role, users);
    }

    // Create role-specific records
    const doctors = await Promise.all(
      usersByRole.get(Role.DOCTOR).map((user) =>
        prisma.doctor.create({
          data: {
            userId: user.id,
            specialization: faker.helpers.arrayElement([
              "Ayurveda",
              "Panchakarma",
              "Yoga",
            ]),
            experience: faker.number.int({ min: 1, max: 30 }),
            qualification: faker.helpers.arrayElement([
              "BAMS",
              "MD Ayurveda",
              "PhD",
            ]),
            consultationFee: faker.number.float({ min: 500, max: 2000 }),
            rating: faker.number.float({ min: 3, max: 5 }),
            workingHours: { start: "09:00", end: "17:00" },
          },
        })
      )
    );

    const patients = await Promise.all(
      usersByRole.get(Role.PATIENT).map((user) =>
        prisma.patient.create({
          data: {
            userId: user.id,
            prakriti: faker.helpers.arrayElement(Object.values(Prakriti)),
            dosha: faker.helpers.arrayElement(Object.values(Dosha)),
          },
        })
      )
    );

    // Create 50 clinics
    const clinics = await Promise.all(
      Array.from({ length: SEED_COUNT }, () =>
        prisma.clinic.create({
          data: {
            name: faker.company.name(),
            address: faker.location.streetAddress(),
            phone: faker.phone.number(),
          },
        })
      )
    );

    // Create DoctorClinic relationships
    await Promise.all(
      doctors.flatMap((doctor) =>
        clinics.slice(0, 2).map((clinic) =>
          prisma.doctorClinic.create({
            data: {
              doctorId: doctor.id,
              clinicId: clinic.id,
              startTime: new Date(),
              endTime: new Date(),
            },
          })
        )
      )
    );

    // Create 50 therapies
    const therapies = await Promise.all(
      Array.from({ length: SEED_COUNT }, () =>
        prisma.therapy.create({
          data: {
            name: faker.lorem.words(2),
            description: faker.lorem.paragraph(),
            duration: faker.number.int({ min: 30, max: 120 }),
          },
        })
      )
    );

    // Create appointments and related records
    const appointments = await Promise.all(
      Array.from({ length: SEED_COUNT }, async () => {
        const appointment = await prisma.appointment.create({
          data: {
            doctorId: faker.helpers.arrayElement(doctors).id,
            patientId: faker.helpers.arrayElement(patients).id,
            therapyId: faker.helpers.arrayElement(therapies).id,
            scheduledAt: faker.date.future(),
            status: faker.helpers.arrayElement(
              Object.values(AppointmentStatus)
            ),
            type: faker.helpers.arrayElement(Object.values(AppointmentType)),
            reason: faker.lorem.sentence(),
            symptoms: faker.lorem.paragraph(),
          },
        });

        // Create related records
        await Promise.all([
          prisma.payment.create({
            data: {
              appointmentId: appointment.id,
              amount: faker.number.float({ min: 100, max: 1000 }),
              method: faker.helpers.arrayElement(Object.values(PaymentMethod)),
              status: faker.helpers.arrayElement(Object.values(PaymentStatus)),
              transactionId: faker.string.uuid(),
            },
          }),
          prisma.queue.create({
            data: {
              appointmentId: appointment.id,
              queueNumber: faker.number.int({ min: 1, max: 100 }),
              estimatedWaitTime: faker.number.int({ min: 5, max: 60 }),
              status: faker.helpers.arrayElement(Object.values(QueueStatus)),
            },
          }),
        ]);

        return appointment;
      })
    );

    // Create medicines first
    const medicines = await Promise.all(
      Array.from({ length: SEED_COUNT }, () =>
        prisma.medicine.create({
          data: {
            name: faker.lorem.words(2),
            ingredients: faker.lorem.words(5),
            properties: faker.lorem.sentence(),
            dosage: faker.lorem.words(3),
            manufacturer: faker.company.name(),
            type: faker.helpers.arrayElement(Object.values(MedicineType)),
          },
        })
      )
    );

    // Create prescriptions using appointments
    const prescriptions = await Promise.all(
      appointments.map(async (appointment) => {
        const prescription = await prisma.prescription.create({
          data: {
            patientId: appointment.patientId,
            doctorId: appointment.doctorId,
            notes: faker.lorem.paragraph(),
          },
        });

        // Create 2-4 prescription items for each prescription
        const itemCount = faker.number.int({ min: 2, max: 4 });
        await Promise.all(
          Array.from({ length: itemCount }, () =>
            prisma.prescriptionItem.create({
              data: {
                prescriptionId: prescription.id,
                medicineId: faker.helpers.arrayElement(medicines).id,
                dosage: faker.lorem.words(3),
                frequency: faker.helpers.arrayElement([
                  "1-0-1",
                  "1-1-1",
                  "0-0-1",
                ]),
                duration: faker.number.int({ min: 7, max: 30 }).toString(),
              },
            })
          )
        );

        return prescription;
      })
    );

    // Create clinic admins
    const clinicAdmins = await Promise.all(
      usersByRole.get(Role.CLINIC_ADMIN).map((user) =>
        prisma.clinicAdmin.create({
          data: {
            userId: user.id,
            clinicId: faker.helpers.arrayElement(clinics).id,
            // permissions: ["MANAGE_STAFF", "VIEW_REPORTS", "EDIT_SETTINGS"],
          },
        })
      )
    );

    // Create receptionists
    const receptionists = await Promise.all(
      usersByRole.get(Role.RECEPTIONIST).map((user) =>
        prisma.receptionist.create({
          data: {
            userId: user.id,
            clinicId: faker.helpers.arrayElement(clinics).id,
            // shift: faker.helpers.arrayElement(["MORNING", "EVENING"]),
          },
        })
      )
    );

    // Create additional records
    await Promise.all([
      // Create health records
      ...Array.from({ length: SEED_COUNT }, () =>
        prisma.healthRecord.create({
          data: {
            patientId: faker.helpers.arrayElement(patients).id,
            doctorId: faker.helpers.arrayElement(doctors).id,
            recordType: faker.helpers.arrayElement(
              Object.values(HealthRecordType)
            ),
            report: faker.lorem.paragraph(),
            fileUrl: faker.internet.url(),
          },
        })
      ),

      // Create reviews
      ...Array.from({ length: SEED_COUNT }, () =>
        prisma.review.create({
          data: {
            patientId: faker.helpers.arrayElement(patients).id,
            doctorId: faker.helpers.arrayElement(doctors).id,
            rating: faker.number.int({ min: 1, max: 5 }),
            comment: faker.lorem.paragraph(),
          },
        })
      ),

      // Create notifications
      ...Array.from({ length: SEED_COUNT }, () =>
        prisma.notification.create({
          data: {
            userId: faker.helpers.arrayElement([...usersByRole.values()].flat())
              .id,
            type: faker.helpers.arrayElement(Object.values(NotificationType)),
            message: faker.lorem.sentence(),
            status: faker.helpers.arrayElement(
              Object.values(NotificationStatus)
            ),
          },
        })
      ),
    ]);

    console.log("Database seeding completed successfully");
  } catch (error) {
    console.error("Error seeding database:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
