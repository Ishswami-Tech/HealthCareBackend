import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import type { Prisma } from "@prisma/client";

@Injectable()
export class TypedPrismaService {
  constructor(private readonly prisma: PrismaService) {}

  get user() {
    return this.prisma.user;
  }

  get doctor() {
    return this.prisma.doctor;
  }

  get patient() {
    return this.prisma.patient;
  }

  get receptionist() {
    return this.prisma.receptionist;
  }

  get clinicAdmin() {
    return this.prisma.clinicAdmin;
  }

  get superAdmin() {
    return this.prisma.superAdmin;
  }

  get pharmacist() {
    return this.prisma.pharmacist;
  }

  get therapist() {
    return this.prisma.therapist;
  }

  get labTechnician() {
    return this.prisma.labTechnician;
  }

  get financeBilling() {
    return this.prisma.financeBilling;
  }

  get supportStaff() {
    return this.prisma.supportStaff;
  }

  get nurse() {
    return this.prisma.nurse;
  }

  get counselor() {
    return this.prisma.counselor;
  }

  get clinic() {
    return this.prisma.clinic;
  }

  get appointment() {
    return this.prisma.appointment;
  }

  get auditLog() {
    return this.prisma.auditLog;
  }

  get notificationTemplate() {
    return this.prisma.notificationTemplate;
  }

  get reminderSchedule() {
    return this.prisma.reminderSchedule;
  }

  $queryRaw<T = unknown>(
    query: TemplateStringsArray | string,
    ...values: unknown[]
  ): Promise<T> {
    return this.prisma.$queryRaw(query, ...values) as Promise<T>;
  }

  get $transaction() {
    return this.prisma.$transaction;
  }
}
