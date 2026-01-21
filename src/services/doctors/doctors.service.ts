import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { PrismaDelegateArgs, PrismaTransactionClientWithDelegates } from '@core/types/prisma.types';

@Injectable()
export class DoctorsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Helper to ensure Doctor record exists for a user used internally
   */
  async ensureDoctorProfile(userId: string) {
    const existing = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        doctor: { findUnique: (args: PrismaDelegateArgs) => Promise<unknown> };
      };
      return await typedClient.doctor.findUnique({
        where: { userId } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });

    if (!existing) {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            doctor: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
          };
          // Basic empty doctor profile
          return await typedClient.doctor.create({
            data: {
              userId,
              specialization: 'General', // Default
              experience: 0,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId: userId,
          clinicId: '',
          resourceType: 'DOCTOR',
          operation: 'CREATE',
          resourceId: 'new',
          userRole: 'system',
          details: { action: 'ensure_doctor_profile' },
        }
      );
    }
  }

  async createOrUpdateDoctor(data: {
    userId: string;
    clinicId?: string;
    specialization?: string;
    experience?: number;
    qualification?: string;
    consultationFee?: number;
    workingHours?: unknown; // Json
  }) {
    const { userId } = data;

    // 1. Ensure Profile
    await this.ensureDoctorProfile(userId);

    // 2. Update Doctor Details
    const updateData: Record<string, unknown> = {};
    if (data.specialization) updateData['specialization'] = data.specialization;
    if (data.experience !== undefined) updateData['experience'] = data.experience;
    if (data.qualification) updateData['qualification'] = data.qualification;
    if (data.consultationFee !== undefined) updateData['consultationFee'] = data.consultationFee;
    if (data.workingHours) updateData['workingHours'] = data.workingHours;

    if (Object.keys(updateData).length > 0) {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            doctor: { update: (args: PrismaDelegateArgs) => Promise<unknown> };
          };
          return await typedClient.doctor.update({
            where: { userId } as PrismaDelegateArgs,
            data: updateData as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId,
          clinicId: data.clinicId || '',
          resourceType: 'DOCTOR',
          operation: 'UPDATE',
          resourceId: userId,
          userRole: 'system',
          details: { fields: Object.keys(updateData) },
        }
      );
    }

    return { success: true, message: 'Doctor profile updated' };
  }

  async getDoctorProfile(userId: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        user: { findUnique: (args: PrismaDelegateArgs) => Promise<unknown> };
      };
      return await typedClient.user.findUnique({
        where: { id: userId } as PrismaDelegateArgs,
        include: {
          doctor: {
            include: {
              clinics: {
                include: { clinic: true },
              },
            },
          },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  async getAllDoctors(filters?: {
    specialization?: string | undefined;
    clinicId?: string | undefined;
  }) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        user: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
      };

      const where: Record<string, unknown> = { role: 'DOCTOR' };

      if (filters?.specialization) {
        where['doctor'] = {
          specialization: { contains: filters.specialization, mode: 'insensitive' },
        };
      }

      if (filters?.clinicId) {
        const doctorWhere = where['doctor'] as Record<string, unknown>;
        doctorWhere['clinics'] = {
          some: { clinicId: filters.clinicId },
        };
      }

      return await typedClient.user.findMany({
        where: where as PrismaDelegateArgs,
        include: {
          doctor: true,
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }
}
