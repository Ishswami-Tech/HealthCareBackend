import { Appointment, Doctor, Patient, User, Prisma } from '@prisma/client';

export type DoctorWithUser = Doctor & {
  user: User;
};

export type PatientWithUser = Patient & {
  user: User;
};

export type AppointmentWithRelations = Appointment & {
  doctor: DoctorWithUser;
  patient: PatientWithUser;
}; 