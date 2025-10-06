import type { PrismaService } from "./prisma.service";
import type {
  User,
  Doctor,
  Patient,
  Receptionist,
  ClinicAdmin,
  SuperAdmin,
  Pharmacist,
  Therapist,
  LabTechnician,
  FinanceBilling,
  SupportStaff,
  Nurse,
  Counselor,
  Clinic,
  AuditLog,
} from "./prisma.types";
import { Role } from "./prisma.types";

export interface UserWithAllRelations extends User {
  doctor?: Doctor | null;
  patient?: Patient | null;
  receptionists?: Receptionist[];
  clinicAdmins?: ClinicAdmin[];
  superAdmin?: SuperAdmin | null;
  pharmacist?: Pharmacist | null;
  therapist?: Therapist | null;
  labTechnician?: LabTechnician | null;
  financeBilling?: FinanceBilling | null;
  supportStaff?: SupportStaff | null;
  nurse?: Nurse | null;
  counselor?: Counselor | null;
}

export class TypedPrismaOperations {
  constructor(private readonly prisma: PrismaService) {}

  async findUsersWithRole(role?: Role): Promise<UserWithAllRelations[]> {
    return this.prisma.user.findMany({
      where: role ? { role } : undefined,
      include: {
        doctor: role === Role.DOCTOR,
        patient: role === Role.PATIENT,
        receptionists: role === Role.RECEPTIONIST,
        clinicAdmins: role === Role.CLINIC_ADMIN,
        superAdmin: role === Role.SUPER_ADMIN,
        pharmacist: role === Role.PHARMACIST,
        therapist: role === Role.THERAPIST,
        labTechnician: role === Role.LAB_TECHNICIAN,
        financeBilling: role === Role.FINANCE_BILLING,
        supportStaff: role === Role.SUPPORT_STAFF,
        nurse: role === Role.NURSE,
        counselor: role === Role.COUNSELOR,
      },
    }) as Promise<UserWithAllRelations[]>;
  }

  async findUserById(id: string): Promise<UserWithAllRelations | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        doctor: true,
        patient: true,
        receptionists: true,
        clinicAdmins: true,
        superAdmin: true,
        pharmacist: true,
        therapist: true,
        labTechnician: true,
        financeBilling: true,
        supportStaff: true,
        nurse: true,
        counselor: true,
      },
    }) as Promise<UserWithAllRelations | null>;
  }

  async findUserByEmail(email: string): Promise<UserWithAllRelations | null> {
    return this.prisma.user.findFirst({
      where: { email },
      include: {
        doctor: true,
        patient: true,
        receptionists: true,
        clinicAdmins: true,
        superAdmin: true,
        pharmacist: true,
        therapist: true,
        labTechnician: true,
        financeBilling: true,
        supportStaff: true,
        nurse: true,
        counselor: true,
      },
    }) as Promise<UserWithAllRelations | null>;
  }

  async countUsers(): Promise<number> {
    return this.prisma.user.count() as Promise<number>;
  }

  async createUser(data: any): Promise<UserWithAllRelations> {
    return this.prisma.user.create({
      data,
      include: {
        doctor: true,
        patient: true,
        receptionists: true,
        clinicAdmins: true,
        superAdmin: true,
        pharmacist: true,
        therapist: true,
        labTechnician: true,
        financeBilling: true,
        supportStaff: true,
        nurse: true,
        counselor: true,
      },
    }) as Promise<UserWithAllRelations>;
  }

  async updateUser(id: string, data: any): Promise<UserWithAllRelations> {
    return this.prisma.user.update({
      where: { id },
      data,
      include: {
        doctor: true,
        patient: true,
        receptionists: true,
        clinicAdmins: true,
        superAdmin: true,
        pharmacist: true,
        therapist: true,
        labTechnician: true,
        financeBilling: true,
        supportStaff: true,
        nurse: true,
        counselor: true,
      },
    }) as Promise<UserWithAllRelations>;
  }

  async deleteUser(id: string): Promise<User> {
    return this.prisma.user.delete({
      where: { id },
    }) as Promise<User>;
  }

  async createDoctor(data: any): Promise<Doctor> {
    return this.prisma.doctor.create({ data }) as Promise<Doctor>;
  }

  async createPatient(data: any): Promise<Patient> {
    return this.prisma.patient.create({ data }) as Promise<Patient>;
  }

  async createReceptionist(data: any): Promise<Receptionist> {
    return this.prisma.receptionist.create({ data }) as Promise<Receptionist>;
  }

  async createClinicAdmin(data: any): Promise<ClinicAdmin> {
    return this.prisma.clinicAdmin.create({ data }) as Promise<ClinicAdmin>;
  }

  async createSuperAdmin(data: any): Promise<SuperAdmin> {
    return this.prisma.superAdmin.create({ data }) as Promise<SuperAdmin>;
  }

  async createPharmacist(data: any): Promise<Pharmacist> {
    return this.prisma.pharmacist.create({ data }) as Promise<Pharmacist>;
  }

  async createTherapist(data: any): Promise<Therapist> {
    return this.prisma.therapist.create({ data }) as Promise<Therapist>;
  }

  async createLabTechnician(data: any): Promise<LabTechnician> {
    return this.prisma.labTechnician.create({ data }) as Promise<LabTechnician>;
  }

  async createFinanceBilling(data: any): Promise<FinanceBilling> {
    return this.prisma.financeBilling.create({
      data,
    }) as Promise<FinanceBilling>;
  }

  async createSupportStaff(data: any): Promise<SupportStaff> {
    return this.prisma.supportStaff.create({ data }) as Promise<SupportStaff>;
  }

  async createNurse(data: any): Promise<Nurse> {
    return this.prisma.nurse.create({ data }) as Promise<Nurse>;
  }

  async createCounselor(data: any): Promise<Counselor> {
    return this.prisma.counselor.create({ data }) as Promise<Counselor>;
  }

  async deleteDoctor(userId: string): Promise<Doctor> {
    return this.prisma.doctor.delete({ where: { userId } }) as Promise<Doctor>;
  }

  async deletePatient(userId: string): Promise<Patient> {
    return this.prisma.patient.delete({
      where: { userId },
    }) as Promise<Patient>;
  }

  async deleteReceptionist(userId: string): Promise<Receptionist> {
    return this.prisma.receptionist.delete({
      where: { userId },
    }) as Promise<Receptionist>;
  }

  async deleteClinicAdmin(userId: string): Promise<ClinicAdmin> {
    return this.prisma.clinicAdmin.delete({
      where: { userId },
    }) as Promise<ClinicAdmin>;
  }

  async deleteSuperAdmin(userId: string): Promise<SuperAdmin> {
    return this.prisma.superAdmin.delete({
      where: { userId },
    }) as Promise<SuperAdmin>;
  }

  async deletePharmacist(userId: string): Promise<Pharmacist> {
    return this.prisma.pharmacist.delete({
      where: { userId },
    }) as Promise<Pharmacist>;
  }

  async deleteTherapist(userId: string): Promise<Therapist> {
    return this.prisma.therapist.delete({
      where: { userId },
    }) as Promise<Therapist>;
  }

  async deleteLabTechnician(userId: string): Promise<LabTechnician> {
    return this.prisma.labTechnician.delete({
      where: { userId },
    }) as Promise<LabTechnician>;
  }

  async deleteFinanceBilling(userId: string): Promise<FinanceBilling> {
    return this.prisma.financeBilling.delete({
      where: { userId },
    }) as Promise<FinanceBilling>;
  }

  async deleteSupportStaff(userId: string): Promise<SupportStaff> {
    return this.prisma.supportStaff.delete({
      where: { userId },
    }) as Promise<SupportStaff>;
  }

  async deleteNurse(userId: string): Promise<Nurse> {
    return this.prisma.nurse.delete({ where: { userId } }) as Promise<Nurse>;
  }

  async deleteCounselor(userId: string): Promise<Counselor> {
    return this.prisma.counselor.delete({
      where: { userId },
    }) as Promise<Counselor>;
  }

  async findClinics(): Promise<Clinic[]> {
    return this.prisma.clinic.findMany() as Promise<Clinic[]>;
  }

  async createAuditLog(data: any): Promise<AuditLog> {
    return this.prisma.auditLog.create({ data }) as Promise<AuditLog>;
  }
}
