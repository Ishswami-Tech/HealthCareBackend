import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { PrismaDelegateArgs, PrismaTransactionClientWithDelegates } from '@core/types/prisma.types';
import { AssetType, StaticAssetService } from '@infrastructure/storage/static-asset.service';
import { HealthRecordType } from '@core/types/enums.types';
import { AuditInfo } from '@core/types/database.types';

interface MulterFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

@Injectable()
export class PatientsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    private readonly staticAssetService: StaticAssetService
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
      primaryHolder: string;
      coverageStartDate: string;
      coverageEndDate?: string;
      coverageType: string;
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
                primaryHolder: insuranceData.primaryHolder,
                coverageStartDate: new Date(insuranceData.coverageStartDate),
                coverageEndDate: insuranceData.coverageEndDate
                  ? new Date(insuranceData.coverageEndDate)
                  : null,
                coverageType: insuranceData.coverageType,
              } as PrismaDelegateArgs,
            });
          } else {
            return await typedClient.insurance.create({
              data: {
                userId,
                provider: insuranceData.provider,
                policyNumber: insuranceData.policyNumber,
                groupNumber: insuranceData.groupNumber,
                primaryHolder: insuranceData.primaryHolder,
                coverageStartDate: new Date(insuranceData.coverageStartDate),
                coverageEndDate: insuranceData.coverageEndDate
                  ? new Date(insuranceData.coverageEndDate)
                  : null,
                coverageType: insuranceData.coverageType,
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
        primaryHolder: string;
        coverageStartDate: string;
        coverageEndDate?: string;
        coverageType: string;
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

  /**
   * Check if patient belongs to clinic (via primaryClinicId or appointments)
   */
  async isPatientInClinic(patientUserId: string, clinicId: string): Promise<boolean> {
    return await this.databaseService.executeHealthcareRead<boolean>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        user: {
          findUnique: (
            args: PrismaDelegateArgs
          ) => Promise<{ primaryClinicId: string | null } | null>;
        };
        appointment: { findFirst: (args: PrismaDelegateArgs) => Promise<unknown> };
        patient: { findUnique: (args: PrismaDelegateArgs) => Promise<{ id: string } | null> };
      };
      const user = (await typedClient.user.findUnique({
        where: { id: patientUserId } as PrismaDelegateArgs,
        select: { primaryClinicId: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as { primaryClinicId: string | null } | null;
      if (!user) return false;
      if (user.primaryClinicId === clinicId) return true;
      const patient = (await typedClient.patient.findUnique({
        where: { userId: patientUserId } as PrismaDelegateArgs,
        select: { id: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as { id: string } | null;
      if (!patient) return false;
      const apt = await typedClient.appointment.findFirst({
        where: { patientId: patient.id, clinicId } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
      return !!apt;
    });
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

  /**
   * Get patients for a clinic. When doctorUserId provided, filter to patients with appointments with that doctor.
   */
  async getClinicPatients(clinicId: string, search?: string, doctorUserId?: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        appointment: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
        patient: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
        doctor: { findUnique: (args: PrismaDelegateArgs) => Promise<{ id: string } | null> };
      };

      let patientIds: string[];

      if (doctorUserId) {
        const doctor = (await typedClient.doctor.findUnique({
          where: { userId: doctorUserId } as PrismaDelegateArgs,
          select: { id: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs)) as { id: string } | null;
        if (!doctor) return [];
        const appointments = (await typedClient.appointment.findMany({
          where: { clinicId, doctorId: doctor.id } as PrismaDelegateArgs,
          select: { patientId: true } as PrismaDelegateArgs,
          distinct: ['patientId'] as unknown as PrismaDelegateArgs,
        } as PrismaDelegateArgs)) as Array<{ patientId: string }>;
        patientIds = appointments.map(a => a.patientId);
      } else {
        const appointments = (await typedClient.appointment.findMany({
          where: { clinicId } as PrismaDelegateArgs,
          select: { patientId: true } as PrismaDelegateArgs,
          distinct: ['patientId'] as unknown as PrismaDelegateArgs,
        } as PrismaDelegateArgs)) as Array<{ patientId: string }>;
        patientIds = appointments.map(a => a.patientId);
      }

      if (patientIds.length === 0) return [];

      const patients = await typedClient.patient.findMany({
        where: { id: { in: patientIds } } as PrismaDelegateArgs,
        include: {
          user: true,
          vitals: { take: 1, orderBy: { recordedAt: 'desc' } },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);

      if (search) {
        const s = search.toLowerCase();
        const typed = patients as unknown as Array<{
          user?: {
            firstName?: string | null;
            lastName?: string | null;
            email?: string;
            phone?: string | null;
          };
        }>;
        return typed.filter(
          p =>
            p.user?.firstName?.toLowerCase().includes(s) ||
            p.user?.lastName?.toLowerCase().includes(s) ||
            p.user?.email?.toLowerCase().includes(s) ||
            p.user?.phone?.toLowerCase().includes(s)
        );
      }
      return patients;
    });
  }

  /**
   * Upload patient document and create health record
   */
  async uploadPatientDocument(patientId: string, file: MulterFile, auditInfo: AuditInfo) {
    const fileName = `doc-${patientId}-${Date.now()}`;
    const asset = await this.staticAssetService.uploadFile(
      file.buffer,
      fileName,
      AssetType.DOCUMENT,
      file.mimetype,
      true
    );

    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          healthRecord: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.healthRecord.create({
          data: {
            patientId,
            recordType: HealthRecordType.GENERAL_DOCUMENT,
            fileUrl: asset.url,
            clinicId: auditInfo.clinicId,
            doctorId: auditInfo.userId, // Default to uploader
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        ...auditInfo,
        resourceType: 'HEALTH_RECORD',
        operation: 'CREATE',
        resourceId: 'new',
        userRole: 'system',
        details: { action: 'upload_document', assetId: asset.key },
      }
    );
  }

  /**
   * Get patient insurance details
   */
  async getInsurance(patientId: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        insurance: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
      };
      return await typedClient.insurance.findMany({
        where: { patientId } as PrismaDelegateArgs,
        orderBy: { createdAt: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }
}
