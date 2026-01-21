import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { PrismaDelegateArgs, PrismaTransactionClientWithDelegates } from '@core/types/prisma.types';

@Injectable()
export class PatientsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Helper to ensure Patient record exists for a user
   */
  async ensurePatientProfile(userId: string) {
    const existing = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        patient: { findUnique: (args: PrismaDelegateArgs) => Promise<unknown> };
      };
      return await typedClient.patient.findUnique({
        where: { userId } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });

    if (!existing) {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            patient: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
          };
          return await typedClient.patient.create({
            data: { userId } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId: userId,
          clinicId: '',
          resourceType: 'PATIENT',
          operation: 'CREATE',
          resourceId: 'new',
          userRole: 'system',
          details: { action: 'ensure_patient_profile' },
        }
      );
    }
  }

  /**
   * Create or Update full patient profile
   * Handles Insurance, Emergency Contact through standard relations
   */
  async createOrUpdatePatient(data: {
    userId: string;
    clinicId?: string;
    dateOfBirth?: string;
    gender?: 'MALE' | 'FEMALE' | 'OTHER';
    bloodGroup?: string;
    height?: number;
    weight?: number;
    allergies?: string[];
    medicalHistory?: string[];
    emergencyContact?: {
      name: string;
      relationship: string;
      phone: string;
    };
    insurance?: {
      provider: string;
      policyNumber: string;
      groupNumber?: string;
    };
  }) {
    const { userId } = data;

    // 1. Ensure Patient Record Exists
    await this.ensurePatientProfile(userId);

    // 2. Update User Profile (Gender, DOB)
    if (data.gender || data.dateOfBirth) {
      const updateData: Record<string, unknown> = {};
      if (data.gender) updateData['gender'] = data.gender;
      if (data.dateOfBirth) updateData['dateOfBirth'] = new Date(data.dateOfBirth);

      await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            user: { update: (args: PrismaDelegateArgs) => Promise<unknown> };
          };
          return await typedClient.user.update({
            where: { id: userId } as PrismaDelegateArgs,
            data: updateData as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId,
          clinicId: data.clinicId || '',
          resourceType: 'USER',
          operation: 'UPDATE',
          resourceId: userId,
          userRole: 'system',
          details: { fields: Object.keys(updateData) },
        }
      );
    }

    // 3. Update Vitals (Height/Weight) -> Should use EHR Service really, but doing simple latest update here or creating new vital
    // Skipping for now to keep strict separation, or could create a Vital entry.

    // 4. Handle Insurance (Upsert Logic)
    if (data.insurance) {
      const insuranceData = data.insurance;
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            insurance: {
              findFirst: (args: PrismaDelegateArgs) => Promise<unknown>;
              update: (args: PrismaDelegateArgs) => Promise<unknown>;
              create: (args: PrismaDelegateArgs) => Promise<unknown>;
            };
          };

          const existingInsurance = (await typedClient.insurance.findFirst({
            where: { userId: userId } as PrismaDelegateArgs,
          })) as { id: string } | null;

          if (existingInsurance) {
            return await typedClient.insurance.update({
              where: { id: existingInsurance.id } as PrismaDelegateArgs,
              data: {
                provider: insuranceData.provider,
                policyNumber: insuranceData.policyNumber,
                groupNumber: insuranceData.groupNumber,
              } as PrismaDelegateArgs,
            });
          } else {
            return await typedClient.insurance.create({
              data: {
                userId,
                provider: insuranceData.provider,
                policyNumber: insuranceData.policyNumber,
                groupNumber: insuranceData.groupNumber,
                validFrom: new Date(),
              } as PrismaDelegateArgs,
            });
          }
        },
        {
          userId,
          clinicId: data.clinicId || '',
          resourceType: 'INSURANCE',
          operation: 'UPSERT',
          resourceId: userId,
          userRole: 'system',
          details: { provider: insuranceData.provider },
        }
      );
    }

    // 5. Handle Emergency Contact (Upsert Logic)
    if (data.emergencyContact) {
      const contactData = data.emergencyContact;
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            emergencyContact: {
              findFirst: (args: PrismaDelegateArgs) => Promise<unknown>;
              update: (args: PrismaDelegateArgs) => Promise<unknown>;
              create: (args: PrismaDelegateArgs) => Promise<unknown>;
            };
          };

          const existingContact = (await typedClient.emergencyContact.findFirst({
            where: { userId: userId } as PrismaDelegateArgs,
          })) as { id: string } | null;

          if (existingContact) {
            return await typedClient.emergencyContact.update({
              where: { id: existingContact.id } as PrismaDelegateArgs,
              data: {
                name: contactData.name,
                relationship: contactData.relationship,
                phone: contactData.phone,
              } as PrismaDelegateArgs,
            });
          } else {
            return await typedClient.emergencyContact.create({
              data: {
                userId,
                name: contactData.name,
                relationship: contactData.relationship,
                phone: contactData.phone,
              } as PrismaDelegateArgs,
            });
          }
        },
        {
          userId,
          clinicId: data.clinicId || '',
          resourceType: 'EMERGENCY_CONTACT',
          operation: 'UPSERT',
          resourceId: userId,
          userRole: 'system',
          details: { name: contactData.name },
        }
      );
    }

    return { success: true, message: 'Patient profile updated' };
  }

  async updatePatient(id: string, updates: Record<string, unknown>) {
    // Reuse createOrUpdatePatient since it handles existence checks and partial updates internally
    // Ensure the ID passed is the userId
    return this.createOrUpdatePatient({
      ...updates,
      userId: id,
    } as unknown as {
      userId: string;
      clinicId?: string;
      dateOfBirth?: string;
      gender?: 'MALE' | 'FEMALE' | 'OTHER';
      bloodGroup?: string;
      height?: number;
      weight?: number;
      allergies?: string[];
      medicalHistory?: string[];
      emergencyContact?: {
        name: string;
        relationship: string;
        phone: string;
      };
      insurance?: {
        provider: string;
        policyNumber: string;
        groupNumber?: string;
      };
    });
  }

  async deletePatient(userId: string) {
    // Soft delete logic usually involves setting isActive: false on the User, effectively disabling the patient profile
    // Or if we need strict deletion of Patient record:
    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          user: { update: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        // We don't delete the user, just maybe mark as inactive or remove 'PATIENT' role?
        // For now, let's assume soft-delete of the User account is sufficient or requested
        return await typedClient.user.update({
          where: { id: userId } as PrismaDelegateArgs,
          data: { isActive: false } as PrismaDelegateArgs,
        });
      },
      {
        userId,
        clinicId: '',
        resourceType: 'PATIENT',
        operation: 'DELETE',
        resourceId: userId,
        userRole: 'system',
        details: { action: 'soft_delete_patient' },
      }
    );
  }

  async getPatientProfile(userId: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        user: { findUnique: (args: PrismaDelegateArgs) => Promise<unknown> };
      };
      // Fetch User with deeply nested patient relations
      return await typedClient.user.findUnique({
        where: { id: userId } as PrismaDelegateArgs,
        include: {
          patient: {
            include: {
              insurance: true,
            },
          },
          emergencyContacts: true,
          medicalHistories: {
            take: 5,
            orderBy: { date: 'desc' },
          },
          vitals: {
            take: 1,
            orderBy: { recordedAt: 'desc' },
          },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  async getClinicPatients(clinicId: string, search?: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        user: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
      };
      // Find users who have accessed this clinic or are part of it, AND utilize role=PATIENT
      // Find users who have accessed this clinic or are part of it, AND utilize role=PATIENT
      const where: Record<string, unknown> = {
        role: 'PATIENT',
        // This logic depends on how users are associated with clinics.
        // Prisma schema: clinics Clinic[] @relation("UserClinics")
        clinics: {
          some: {
            id: clinicId,
          },
        },
      };

      if (search) {
        where['OR'] = [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
        ];
      }

      return await typedClient.user.findMany({
        where: where as PrismaDelegateArgs,
        include: {
          patient: true,
          vitals: { take: 1, orderBy: { recordedAt: 'desc' } },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }
}
