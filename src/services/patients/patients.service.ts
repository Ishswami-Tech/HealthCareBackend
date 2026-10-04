import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { PrismaDelegateArgs, PrismaTransactionClientWithDelegates } from '@core/types/prisma.types';
import { AssetType, StaticAssetService } from '@infrastructure/storage/static-asset.service';
import { HealthRecordType, Role } from '@core/types/enums.types';
import { LogLevel, LogType } from '@core/types/logging.types';
import type { PatientWithUser } from '@core/types';
import {
  AuditInfo,
  type ClinicPatientOptions,
  type ClinicPatientResult,
} from '@core/types/database.types';
import { CacheService } from '@infrastructure/cache/cache.service';
import { RbacService } from '@core/rbac/rbac.service';
import {
  isPatientTargetAllowed,
  resolvePatientAccessScope,
} from '@core/guards/patient-self-access.guard';
import {
  buildDocumentStorageName,
  extractStoredFileRef,
  PHI_FILE_FOLDERS,
  buildProfilePhotoStorageName,
  resolveAttributionDoctorId,
  validatePatientDocumentUpload,
  validateProfilePhotoFile,
} from './patient-document.util';

// Cross-module collaborators (used only by the dashboard summary path).
// forwardRef is required to avoid pulling these in at module init time.
import { AppointmentsService } from '@services/appointments/appointments.service';
import { EHRService } from '@services/ehr/ehr.service';
import { BillingService } from '@services/billing/billing.service';
import { PharmacyService } from '@services/pharmacy/services/pharmacy.service';
import type { PatientDashboardSummaryDto } from './dashboard-summary.dto';

interface MulterFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/**
 * Staff roles that may EVER list / delete patient documents. This is the second lock
 * behind the controller's @Roles list and the RBAC `medical-records` permission: some
 * non-clinical roles hold `medical-records:read` (RECEPTIONIST does, see
 * rbac.service.ts), so widening @Roles must never be enough to expose documents. Add a
 * role here only as a deliberate clinical-access decision. PATIENT is handled by
 * ownership, not by this list.
 */
const DOCUMENT_STAFF_ROLES: ReadonlySet<string> = new Set<string>([
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
]);

/** HealthRecord columns the patient-document views are built from. */
interface HealthRecordDocumentRow {
  id: string;
  title?: string | null;
  report?: string | null;
  notes?: string | null;
  fileUrl?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  recordType?: string | null;
  uploadedBy?: string | null;
  createdAt: Date | string;
}

@Injectable()
export class PatientsService {
  /** Dashboard-summary cache TTL — 180s, with a 45s stale-serve window
   *  (`DASHBOARD_SUMMARY_STALE_SECONDS`). The frontend polls this endpoint
   *  every 60s whenever the realtime socket is disconnected
   *  (usePatientDashboardSummary's `refetchInterval`). A TTL equal to that
   *  poll interval means every scheduled poll lands exactly on a fully
   *  expired key — SWR never gets to serve stale-and-revalidate-in-background,
   *  so the full 5-way fan-out (appointments/EHR/prescriptions/invoices/
   *  payments) runs synchronously on almost every poll. Keeping TTL well
   *  above the poll interval lets most polls hit the fast stale-serve path. */
  private static readonly DASHBOARD_SUMMARY_TTL_SECONDS = 180;
  private static readonly DASHBOARD_SUMMARY_STALE_SECONDS = 45;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    private readonly staticAssetService: StaticAssetService,
    private readonly cacheService: CacheService,
    // Optional so existing unit tests that mock PatientsService don't have
    // to wire up the full cross-module graph. The controller-only
    // `getDashboardSummary` path checks for presence before delegating.
    @Inject(forwardRef(() => AppointmentsService))
    private readonly appointmentsService?: AppointmentsService,
    @Inject(forwardRef(() => EHRService))
    private readonly ehrService?: EHRService,
    @Inject(forwardRef(() => BillingService))
    private readonly billingService?: BillingService,
    @Inject(forwardRef(() => PharmacyService))
    private readonly pharmacyService?: PharmacyService,
    // Staff document access is decided by RBAC (medical-records:read/delete). The
    // dependency is optional only so unit tests that never touch documents can
    // omit it; the document paths fail closed when it is missing.
    @Optional()
    @Inject(forwardRef(() => RbacService))
    private readonly rbacService?: RbacService
  ) {}

  /**
   * Helper to ensure Patient record exists for a user
   * @param userId - The user ID
   * @param clinicId - Optional clinic ID for isolation; uses user's primaryClinicId if not provided
   */
  async ensurePatientProfile(userId: string, clinicId?: string) {
    // Get user's primaryClinicId for proper clinic isolation
    const user = await this.databaseService.findUserByIdSafe(userId);
    const effectiveClinicId = clinicId || user?.primaryClinicId;

    const existing = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        patient: { findFirst: (args: PrismaDelegateArgs) => Promise<unknown> };
      };
      return await typedClient.patient.findFirst({
        where: {
          userId,
          ...(effectiveClinicId
            ? {
                user: { primaryClinicId: effectiveClinicId },
              }
            : {}),
        } as PrismaDelegateArgs,
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
          clinicId: effectiveClinicId || '',
          resourceType: 'PATIENT',
          operation: 'CREATE',
          resourceId: 'new',
          userRole: 'system',
          details: { action: 'ensure_patient_profile', clinicId: effectiveClinicId },
        }
      );

      // Invalidate cached null profile so that dashboard reflects existence instantly
      await this.cacheService.invalidatePatientCache(userId);
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
    address?: string;
    area?: string;
    district?: string;
    occupation?: string;
    maritalStatus?: string;
    organization?: string;
  }) {
    const { userId } = data;

    // Validate clinic association when clinicId is provided
    if (data.clinicId) {
      const user = await this.databaseService.findUserByIdSafe(userId);
      if (!user) {
        throw new ForbiddenException('User not found');
      }
      const userClinicId = user.primaryClinicId;
      if (userClinicId && userClinicId !== data.clinicId) {
        throw new ForbiddenException('User does not belong to this clinic');
      }
    }

    // 1. Ensure Patient Record Exists
    await this.ensurePatientProfile(userId, data.clinicId);

    // 2. Update User Profile (Gender, DOB, registration-desk demographics)
    const updateData: Record<string, unknown> = {};
    if (data.gender) updateData['gender'] = data.gender;
    if (data.dateOfBirth) updateData['dateOfBirth'] = new Date(data.dateOfBirth);
    // bloodGroup used to be accepted by the DTO and silently dropped here; it (and the
    // marital status) are User columns like the other demographics.
    const demographicKeys = [
      'address',
      'area',
      'district',
      'occupation',
      'maritalStatus',
      'bloodGroup',
      'organization',
    ] as const;
    for (const key of demographicKeys) {
      const value = data[key];
      if (value !== undefined) updateData[key] = value.trim() || null;
    }

    if (Object.keys(updateData).length > 0) {
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
      const user = await this.databaseService.findUserByIdSafe(userId);
      const effectiveClinicId = data.clinicId || user?.primaryClinicId;

      await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            insurance: {
              findFirst: (args: PrismaDelegateArgs) => Promise<unknown>;
              update: (args: PrismaDelegateArgs) => Promise<unknown>;
              create: (args: PrismaDelegateArgs) => Promise<unknown>;
            };
          };

          // Insurance has no clinicId column (filtering / writing one is a Prisma
          // validation error), so the policy is looked up per user.
          const existingInsurance = (await typedClient.insurance.findFirst({
            where: { userId } as PrismaDelegateArgs,
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
          clinicId: effectiveClinicId || '',
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
      const user = await this.databaseService.findUserByIdSafe(userId);
      const effectiveClinicId = data.clinicId || user?.primaryClinicId;

      await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            emergencyContact: {
              findFirst: (args: PrismaDelegateArgs) => Promise<unknown>;
              update: (args: PrismaDelegateArgs) => Promise<unknown>;
              create: (args: PrismaDelegateArgs) => Promise<unknown>;
            };
          };

          // EmergencyContact has no clinicId column: filtering / writing one is a Prisma
          // validation error, which used to abort every emergency-contact save here.
          const existingContact = (await typedClient.emergencyContact.findFirst({
            where: { userId, isActive: true, deletedAt: null } as PrismaDelegateArgs,
            orderBy: { createdAt: 'asc' } as PrismaDelegateArgs,
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
          clinicId: effectiveClinicId || '',
          resourceType: 'EMERGENCY_CONTACT',
          operation: 'UPSERT',
          resourceId: userId,
          userRole: 'system',
          details: { name: contactData.name },
        }
      );
    }

    // Invalidate cached patient profile upon upserting profile details
    await this.cacheService.invalidatePatientCache(userId, data.clinicId);

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
      address?: string;
      area?: string;
      district?: string;
      occupation?: string;
      maritalStatus?: string;
      organization?: string;
    });
  }

  async deletePatient(userId: string, clinicId?: string) {
    // Get user's primaryClinicId for proper clinic isolation
    const user = await this.databaseService.findUserByIdSafe(userId);
    const effectiveClinicId = clinicId || user?.primaryClinicId;

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
        clinicId: effectiveClinicId || '',
        resourceType: 'PATIENT',
        operation: 'DELETE',
        resourceId: userId,
        userRole: 'system',
        details: { action: 'soft_delete_patient', clinicId: effectiveClinicId },
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

  async getPatientRecordForClinic(
    patientIdentifier: string,
    clinicId: string
  ): Promise<{ id: string; userId: string } | null> {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        patient: {
          findFirst: (args: PrismaDelegateArgs) => Promise<unknown>;
        };
      };

      const patient = (await typedClient.patient.findFirst({
        where: {
          OR: [{ id: patientIdentifier }, { userId: patientIdentifier }],
        } as PrismaDelegateArgs,
        select: {
          id: true,
          userId: true,
          user: {
            select: {
              primaryClinicId: true,
            },
          },
          appointments: {
            where: { clinicId } as PrismaDelegateArgs,
            select: { id: true } as PrismaDelegateArgs,
            take: 1,
          },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as {
        id: string;
        userId: string;
        user?: { primaryClinicId?: string | null } | null;
        appointments?: Array<{ id: string }>;
      } | null;

      if (!patient) {
        return null;
      }

      const belongsToClinic =
        patient.user?.primaryClinicId === clinicId || (patient.appointments?.length || 0) > 0;

      if (!belongsToClinic) {
        return null;
      }

      return { id: patient.id, userId: patient.userId };
    });
  }

  /** Credentials / sign-in metadata that must never leave the API in a profile response. */
  private static readonly PROFILE_OMITTED_USER_FIELDS = {
    password: true,
    googleId: true,
    facebookId: true,
    appleId: true,
    lastLoginIP: true,
    lastLoginDevice: true,
  } as const;

  async getPatientProfile(userId: string) {
    const user = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        user: { findUnique: (args: PrismaDelegateArgs) => Promise<unknown> };
      };
      // Fetch User with deeply nested patient relations. The password hash and the
      // social-login ids used to be returned with the profile; they are omitted now.
      return (await typedClient.user.findUnique({
        where: { id: userId } as PrismaDelegateArgs,
        omit: PatientsService.PROFILE_OMITTED_USER_FIELDS,
        include: {
          patient: {
            include: {
              insurance: true,
            },
          },
          emergencyContacts: { where: { isActive: true, deletedAt: null } },
          medicalHistories: {
            take: 5,
            orderBy: { date: 'desc' },
          },
          vitals: {
            take: 1,
            orderBy: { recordedAt: 'desc' },
          },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as Record<string, unknown> | null;
    });
    if (!user) {
      return user;
    }
    const contacts: unknown[] = Array.isArray(user['emergencyContacts'])
      ? (user['emergencyContacts'] as unknown[])
      : [];
    const photo = typeof user['profilePicture'] === 'string' ? user['profilePicture'] : null;
    return {
      ...user,
      // The primary emergency contact as a single object (the list stays for old clients).
      emergencyContact: contacts[0] ?? null,
      ...(photo ? { profilePicture: await this.resolveProfilePhotoUrl(userId, photo) } : {}),
    };
  }

  /**
   * Profile photos are PRIVATE objects stored under `documents/avatar-<userId>-<ts>.<ext>`;
   * reads get a short-lived presigned URL bound to the owner's id. Anything else stored in
   * `profilePicture` (a social-login avatar URL, a local-disk path) is returned unchanged.
   */
  async resolveProfilePhotoUrl(userId: string, storedUrl: string): Promise<string> {
    return await this.staticAssetService.resolveSignedUrl(storedUrl, undefined, {
      boundTo: [userId],
    });
  }

  /**
   * Replace a patient's profile photo. A PATIENT can only change their own; staff only
   * for a patient of their clinic. The file is checked like a document (type by file
   * signature) and must be an image of at most 5 MB. Stored private; returns the
   * presigned URL. The previous photo object is removed once the new one is saved.
   */
  async uploadProfilePhoto(
    targetUserId: string,
    file: MulterFile,
    actor: AuditInfo
  ): Promise<{ profilePicture: string }> {
    if (actor.userRole === String(Role.PATIENT)) {
      if (actor.userId !== targetUserId) {
        throw new ForbiddenException('You can only change your own profile photo');
      }
    } else if (!(await this.isPatientInClinic(targetUserId, actor.clinicId))) {
      throw new ForbiddenException('Patient does not belong to your clinic');
    }

    const validated = validateProfilePhotoFile(file);
    const asset = await this.staticAssetService.uploadFile(
      file.buffer,
      buildProfilePhotoStorageName(targetUserId, validated.extension),
      AssetType.DOCUMENT,
      validated.mimeType,
      false
    );
    if (!asset.success || !asset.url) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Profile photo upload was not stored',
        'PatientsService',
        { userId: targetUserId, clinicId: actor.clinicId, error: asset.error }
      );
      throw new InternalServerErrorException('Could not store the photo. Please try again.');
    }
    const storedUrl = asset.url;

    let previous: string | null;
    try {
      previous = await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            user: {
              findUnique: (args: PrismaDelegateArgs) => Promise<unknown>;
              update: (args: PrismaDelegateArgs) => Promise<unknown>;
            };
          };
          const existing = (await typedClient.user.findUnique({
            where: { id: targetUserId } as PrismaDelegateArgs,
            select: { profilePicture: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs)) as { profilePicture: string | null } | null;
          if (!existing) {
            throw new NotFoundException('Patient not found');
          }
          await typedClient.user.update({
            where: { id: targetUserId } as PrismaDelegateArgs,
            data: { profilePicture: storedUrl } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          return existing.profilePicture;
        },
        {
          ...actor,
          resourceType: 'USER',
          operation: 'UPDATE',
          resourceId: targetUserId,
          details: { action: 'update_profile_photo', assetId: asset.key },
        }
      );
    } catch (error) {
      await this.discardStoredFile(
        asset.key ?? extractStoredFileRef(storedUrl, PHI_FILE_FOLDERS) ?? asset.localPath,
        { userId: targetUserId, clinicId: actor.clinicId, reason: 'profile photo save failed' }
      );
      throw error;
    }

    // Only our own avatar objects are removed (never a social-login URL or a document).
    const previousRef = extractStoredFileRef(previous, [AssetType.DOCUMENT]);
    if (previousRef && previousRef.includes(`avatar-${targetUserId}-`)) {
      await this.discardStoredFile(previousRef, {
        userId: targetUserId,
        clinicId: actor.clinicId,
        reason: 'profile photo replaced',
      });
    }
    await this.cacheService.invalidatePatientCache(targetUserId, actor.clinicId);
    return { profilePicture: await this.resolveProfilePhotoUrl(targetUserId, storedUrl) };
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

      let patientIds: string[] = [];

      // 1. Get patients who have appointments in this clinic
      if (doctorUserId) {
        const doctor = (await typedClient.doctor.findUnique({
          where: { userId: doctorUserId } as PrismaDelegateArgs,
          select: { id: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs)) as { id: string } | null;

        if (doctor) {
          const appointments = (await typedClient.appointment.findMany({
            where: { clinicId, doctorId: doctor.id } as PrismaDelegateArgs,
            select: { patientId: true } as PrismaDelegateArgs,
            distinct: ['patientId'] as unknown as PrismaDelegateArgs,
          } as PrismaDelegateArgs)) as Array<{ patientId: string }>;
          patientIds = appointments.map(a => a.patientId);
        }
      } else {
        const appointments = (await typedClient.appointment.findMany({
          where: { clinicId } as PrismaDelegateArgs,
          select: { patientId: true } as PrismaDelegateArgs,
          distinct: ['patientId'] as unknown as PrismaDelegateArgs,
        } as PrismaDelegateArgs)) as Array<{ patientId: string }>;
        patientIds = appointments.map(a => a.patientId);

        // 2. ALSO get patients linked via various relations
        const usersInClinic = (await typedClient.user.findMany({
          where: {
            OR: [
              { primaryClinicId: clinicId },
              { clinics: { some: { id: clinicId } } },
              { userRoles: { some: { clinicId, isActive: true } } },
            ],
            role: 'PATIENT',
          } as PrismaDelegateArgs,
          select: {
            patient: { select: { id: true } },
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs)) as Array<{ patient: { id: string } | null }>;

        const relatedPatientIds = usersInClinic.filter(u => u.patient).map(u => u.patient!.id);

        // Combine and deduplicate
        patientIds = Array.from(new Set([...patientIds, ...relatedPatientIds]));
      }

      if (patientIds.length === 0) return [];

      const patients = await typedClient.patient.findMany({
        where: { id: { in: patientIds } } as PrismaDelegateArgs,
        include: {
          user: true,
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
        ) as unknown as PatientWithUser[];
      }
      return patients as PatientWithUser[];
    });
  }

  async getClinicPatientsPaginated(
    clinicId: string,
    options?: ClinicPatientOptions,
    doctorUserId?: string
  ): Promise<ClinicPatientResult> {
    const page = Math.max(options?.page || 1, 1);
    const limit = Math.min(options?.limit || 50, 100);

    if (!doctorUserId) {
      return await this.databaseService.getClinicPatients(clinicId, {
        page,
        limit,
        ...(options?.searchTerm?.trim() ? { searchTerm: options.searchTerm.trim() } : {}),
        ...(typeof options?.includeInactive === 'boolean'
          ? { includeInactive: options.includeInactive }
          : {}),
      });
    }

    const patients = await this.getClinicPatients(clinicId, options?.searchTerm, doctorUserId);
    const total = patients.length;
    const skip = (page - 1) * limit;

    return {
      patients: patients.slice(skip, skip + limit),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ============================================================================
  // PATIENT DOCUMENTS (HealthRecord rows of type GENERAL_DOCUMENT)
  // ============================================================================

  /**
   * HealthRecord.doctorId is a required FK to Doctor.id. Resolve the doctor a
   * document upload is attributed to, deterministically:
   *   1. the uploader, if they are a doctor;
   *   2. the doctor of the patient's most recent appointment in this clinic;
   *   3. the longest-standing ACTIVE doctor linked to this clinic.
   * Returns null when the clinic has no usable doctor (the caller then rejects
   * the upload with a clear message instead of picking an arbitrary row).
   */
  private async resolveDoctorIdForDocument(
    patientRecordId: string,
    uploaderUserId: string,
    clinicId: string
  ): Promise<string | null> {
    return await resolveAttributionDoctorId(
      this.databaseService,
      patientRecordId,
      uploaderUserId,
      clinicId
    );
  }

  /**
   * Client view of a stored document. Documents are PRIVATE objects: `url` is a
   * short-lived (15 min) presigned GET URL, so it must only be produced when a
   * document is returned to the caller (never persisted). Legacy public-read
   * objects are signed the same way; local-disk URLs and signing failures keep the
   * stored value.
   *
   * `owner` identifies the patient the row belongs to: the object key must contain the
   * patient's id (Patient.id, or User.id for legacy uploads, see
   * `buildDocumentStorageName`), so a stored URL pointing at another patient's object is
   * never presigned.
   */
  private async toClientDocument(
    r: HealthRecordDocumentRow,
    owner: { id: string; userId: string }
  ) {
    const document = this.mapHealthRecordToDocument(r);
    if (!document.url) {
      return document;
    }
    return {
      ...document,
      url: await this.staticAssetService.resolveSignedUrl(document.url, undefined, {
        boundTo: [owner.id, owner.userId],
      }),
    };
  }

  private mapHealthRecordToDocument(r: HealthRecordDocumentRow) {
    return {
      id: r.id,
      category: r.report || 'OTHER',
      description: r.notes || undefined,
      fileName: r.title || 'Document',
      fileSize: r.fileSize ?? undefined,
      fileType: r.mimeType || undefined,
      url: r.fileUrl || undefined,
      recordType: r.recordType || undefined,
      uploadedBy: r.uploadedBy || undefined,
      uploadedAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    };
  }

  /**
   * Staff (non-PATIENT) access to patient documents needs BOTH:
   *  1. a role in `DOCUMENT_STAFF_ROLES` (explicit allow-list: RECEPTIONIST and every
   *     other non-clinical role is denied here, whatever @Roles or RBAC say), and
   *  2. the same RBAC permission the EHR medical-records routes use
   *     (`medical-records:read` / `medical-records:delete`). NOTE: RECEPTIONIST does
   *     hold `medical-records:read` in rbac.service.ts, so the permission alone does
   *     NOT keep receptionists out; check 1 does.
   * The route's @Roles list only says which roles may reach the handler. Fails closed
   * when RBAC is not wired.
   */
  private async assertStaffDocumentPermission(
    auditInfo: AuditInfo,
    action: 'read' | 'delete'
  ): Promise<void> {
    if (!DOCUMENT_STAFF_ROLES.has(String(auditInfo.userRole ?? ''))) {
      throw new ForbiddenException(`Your role may not ${action} patient documents`);
    }
    if (!this.rbacService) {
      throw new InternalServerErrorException('Authorization service is unavailable');
    }
    const check = await this.rbacService.checkPermission({
      userId: auditInfo.userId,
      clinicId: auditInfo.clinicId,
      resource: 'medical-records',
      action,
    });
    if (!check.hasPermission) {
      throw new ForbiddenException(`Insufficient permissions to ${action} patient documents`);
    }
  }

  /**
   * A PATIENT may act on their own patient record or on the record of an ACTIVE
   * dependent they are the primary patient of (FamilyMember link).
   */
  private async assertPatientOwnsRecord(
    callerUserId: string,
    patientRecord: { id: string; userId: string },
    deniedMessage: string
  ): Promise<void> {
    if (patientRecord.userId === callerUserId) {
      return;
    }
    const scope = await resolvePatientAccessScope(this.databaseService, callerUserId);
    if (
      !isPatientTargetAllowed(scope, patientRecord.id) &&
      !isPatientTargetAllowed(scope, patientRecord.userId)
    ) {
      throw new ForbiddenException(deniedMessage);
    }
  }

  /** Patient row by Patient.id or User.id, with no clinic condition. */
  private async findPatientRecord(
    patientIdentifier: string
  ): Promise<{ id: string; userId: string } | null> {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        patient: { findFirst: (args: PrismaDelegateArgs) => Promise<unknown> };
      };
      return (await typedClient.patient.findFirst({
        where: {
          OR: [{ id: patientIdentifier }, { userId: patientIdentifier }],
        } as PrismaDelegateArgs,
        select: { id: true, userId: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as { id: string; userId: string } | null;
    });
  }

  /**
   * Shared authorization for listing/deleting documents.
   *  - PATIENT: ownership only (own record or an ACTIVE dependent's). The request
   *    clinic plays no part: a patient registered with several clinics keeps access to
   *    their own documents whichever clinic they are using. An unknown id and a record
   *    that is not theirs produce the same 403.
   *  - Staff: an explicit role allow-list, the medical-records permission for `action`,
   *    and the patient must belong to the request clinic.
   */
  private async authorizeDocumentAccess(
    patientId: string,
    auditInfo: AuditInfo,
    action: 'read' | 'delete',
    deniedMessage: string
  ): Promise<{ id: string; userId: string }> {
    if (auditInfo.userRole === String(Role.PATIENT)) {
      const own = await this.findPatientRecord(patientId);
      if (!own) {
        throw new ForbiddenException(deniedMessage);
      }
      await this.assertPatientOwnsRecord(auditInfo.userId, own, deniedMessage);
      return own;
    }

    await this.assertStaffDocumentPermission(auditInfo, action);
    const scopedPatient = await this.getPatientRecordForClinic(patientId, auditInfo.clinicId);
    if (!scopedPatient) {
      throw new ForbiddenException('Patient does not belong to your clinic');
    }
    return scopedPatient;
  }

  /**
   * List documents uploaded against a patient record (HealthRecord rows of type
   * GENERAL_DOCUMENT created by POST /patients/:id/documents).
   *  - PATIENT: own record or an ACTIVE dependent's, ALL of their documents whichever
   *    clinic the request uses (filtered by patient, not by request clinic).
   *  - Staff: a clinical role (DOCUMENT_STAFF_ROLES) holding `medical-records:read`,
   *    and only the documents of the request clinic.
   */
  async listPatientDocuments(patientId: string, auditInfo: AuditInfo) {
    const scopedPatient = await this.authorizeDocumentAccess(
      patientId,
      auditInfo,
      'read',
      'You can only view your own documents'
    );
    const isPatient = auditInfo.userRole === String(Role.PATIENT);

    const rows = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        healthRecord: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
      };
      return await typedClient.healthRecord.findMany({
        where: {
          patientId: scopedPatient.id,
          ...(isPatient ? {} : { clinicId: auditInfo.clinicId }),
          recordType: HealthRecordType.GENERAL_DOCUMENT,
        } as PrismaDelegateArgs,
        orderBy: { createdAt: 'desc' } as PrismaDelegateArgs,
        take: 200,
      } as PrismaDelegateArgs);
    });

    return await Promise.all(
      (rows as HealthRecordDocumentRow[]).map(row => this.toClientDocument(row, scopedPatient))
    );
  }

  /**
   * Delete a patient document.
   *  - PATIENT: only documents they uploaded to their own record (or an ACTIVE
   *    dependent's), whichever clinic the request uses; clinic-uploaded documents
   *    (staff-uploaded, or legacy rows without an `uploadedBy`) are part of the record
   *    and stay.
   *  - Staff: a clinical role (DOCUMENT_STAFF_ROLES) holding `medical-records:delete`,
   *    and the document must belong to the request clinic.
   * The audit entry carries the real actor role. The stored file is removed
   * best-effort after the row is gone (under `documents/` OR `medical-records/`); a
   * storage failure never fails the request.
   */
  async deletePatientDocument(patientId: string, documentId: string, auditInfo: AuditInfo) {
    const scopedPatient = await this.authorizeDocumentAccess(
      patientId,
      auditInfo,
      'delete',
      'You can only delete your own documents'
    );
    const isPatient = auditInfo.userRole === String(Role.PATIENT);

    const record = (await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        healthRecord: { findFirst: (args: PrismaDelegateArgs) => Promise<unknown> };
      };
      return await typedClient.healthRecord.findFirst({
        where: {
          id: documentId,
          patientId: scopedPatient.id,
          ...(isPatient ? {} : { clinicId: auditInfo.clinicId }),
          recordType: HealthRecordType.GENERAL_DOCUMENT,
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    })) as {
      id: string;
      clinicId?: string | null;
      uploadedBy?: string | null;
      fileUrl?: string | null;
    } | null;

    if (!record) {
      throw new NotFoundException('Document not found');
    }
    // A missing `uploadedBy` (staff-uploaded / legacy row) is NOT "uploaded by the
    // patient": it must never be deletable by a PATIENT.
    if (isPatient && record.uploadedBy !== auditInfo.userId) {
      throw new ForbiddenException('You can only delete documents you uploaded');
    }

    await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          healthRecord: { delete: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.healthRecord.delete({
          where: { id: documentId } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        ...auditInfo,
        // audit the clinic the row belongs to (a PATIENT may act from another clinic)
        clinicId: record.clinicId ?? auditInfo.clinicId,
        resourceType: 'HEALTH_RECORD',
        operation: 'DELETE',
        resourceId: documentId,
        details: { action: 'delete_document', patientId: scopedPatient.id },
      }
    );

    // The row's file can live under documents/ (patient uploads) or medical-records/
    // (EHR uploads attached to a GENERAL_DOCUMENT row); remove it from either.
    await this.discardStoredFile(extractStoredFileRef(record.fileUrl, PHI_FILE_FOLDERS), {
      documentId,
      patientId: scopedPatient.id,
      clinicId: record.clinicId ?? auditInfo.clinicId,
      reason: 'document deleted',
    });

    return { success: true, id: documentId };
  }

  /** Best-effort object removal: failures are logged, never thrown. */
  private async discardStoredFile(
    ref: string | null | undefined,
    context: Record<string, unknown>
  ): Promise<void> {
    if (!ref) {
      return;
    }
    try {
      const deleted = await this.staticAssetService.deleteAsset(ref);
      if (!deleted) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Patient document file was not removed from storage',
          'PatientsService',
          { ...context, storageRef: ref }
        );
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Failed to remove patient document file from storage',
        'PatientsService',
        {
          ...context,
          storageRef: ref,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Upload a patient document and create its health record. PATIENT callers may
   * upload to their own record or an ACTIVE dependent's (403 otherwise). The file
   * is checked (non-empty, <= 10 MB, PDF/JPEG/PNG/WebP/HEIC by file signature)
   * and the title/category/description are normalised before anything is stored.
   * The object is stored private; the returned `url` is a presigned URL.
   */
  async uploadPatientDocument(
    patientId: string,
    file: MulterFile,
    auditInfo: AuditInfo,
    meta: { category?: string; description?: string } = {}
  ) {
    // Unlike list / delete (reads and removals of the patient's OWN data, which are
    // clinic-independent for a PATIENT), an upload writes a new row INTO the request
    // clinic, so the patient must be linked to that clinic (primary clinic or an
    // appointment there) for every caller.
    const scopedPatient = await this.getPatientRecordForClinic(patientId, auditInfo.clinicId);

    if (!scopedPatient) {
      throw new ForbiddenException('Patient does not belong to your clinic');
    }

    // PATIENT: own record or an ACTIVE dependent's (same scope as list / delete).
    // The uploader is recorded in `uploadedBy`, which is what the "patients can
    // delete only documents they uploaded" rule compares against.
    if (auditInfo.userRole === String(Role.PATIENT)) {
      await this.assertPatientOwnsRecord(
        auditInfo.userId,
        scopedPatient,
        "You can only upload documents to your own record or an active dependent's record"
      );
    }

    const validated = validatePatientDocumentUpload(file, meta);

    const doctorId = await this.resolveDoctorIdForDocument(
      scopedPatient.id,
      auditInfo.userId,
      auditInfo.clinicId
    );
    if (!doctorId) {
      throw new BadRequestException(
        'No doctor is linked to your record in this clinic yet. Book a visit before uploading documents.'
      );
    }

    const fileName = buildDocumentStorageName(scopedPatient.id, validated.extension);
    const asset = await this.staticAssetService.uploadFile(
      file.buffer,
      fileName,
      AssetType.DOCUMENT,
      validated.mimeType,
      // PRIVATE: clients receive a presigned URL (toClientDocument), never a public one.
      false
    );
    if (!asset.success || !asset.url) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Patient document upload was not stored',
        'PatientsService',
        { patientId: scopedPatient.id, clinicId: auditInfo.clinicId, error: asset.error }
      );
      throw new InternalServerErrorException('Could not store the document. Please try again.');
    }
    const storedUrl = asset.url;

    let created: unknown;
    try {
      created = await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            healthRecord: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
          };
          return await typedClient.healthRecord.create({
            data: {
              patientId: scopedPatient.id,
              recordType: HealthRecordType.GENERAL_DOCUMENT,
              fileUrl: storedUrl,
              clinicId: auditInfo.clinicId,
              // Required FK to Doctor.id (never the uploader's User.id).
              doctorId,
              uploadedBy: auditInfo.userId,
              title: validated.title,
              fileSize: validated.size,
              mimeType: validated.mimeType,
              report: validated.category,
              ...(validated.description ? { notes: validated.description } : {}),
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          ...auditInfo,
          resourceType: 'HEALTH_RECORD',
          operation: 'CREATE',
          resourceId: 'new',
          details: { action: 'upload_document', assetId: asset.key },
        }
      );
    } catch (error) {
      // Do not leave an orphaned object behind when the row could not be written.
      // Relative key / `/storage/...` reference only: an absolute disk path is not an
      // S3 key (and `asset.localPath` is one).
      await this.discardStoredFile(
        asset.key ?? extractStoredFileRef(storedUrl, PHI_FILE_FOLDERS) ?? asset.localPath,
        {
          patientId: scopedPatient.id,
          clinicId: auditInfo.clinicId,
          reason: 'health record insert failed',
        }
      );
      throw error;
    }
    return await this.toClientDocument(created as HealthRecordDocumentRow, scopedPatient);
  }

  /**
   * Get patient insurance details with optional clinic scope
   */
  async getInsurance(patientId: string, clinicId?: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        insurance: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
      };

      // Filter by clinicId if provided for multi-tenant isolation
      const whereClause: Record<string, unknown> = { userId: patientId };
      if (clinicId) {
        whereClause['clinicId'] = clinicId;
      }

      return await typedClient.insurance.findMany({
        where: whereClause as PrismaDelegateArgs,
        orderBy: { createdAt: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  // ============================================================================
  // DASHBOARD SUMMARY (single round-trip composition)
  // ============================================================================
  //
  // Why this lives on PatientsService:
  //   The patient dashboard used to fan out to 6+ independent server actions
  //   on first mount, each costing ~5-9s of round-trip to the backend. This
  //   composition fans out internally via Promise.all and returns one merged
  //   response, cached for 60 seconds so subsequent visits are sub-200ms.
  //
  // Resilience strategy:
  //   Every sub-call is wrapped in try/catch. A single failing sub-call
  //   returns an empty value for that field plus an `errors` map; the
  //   endpoint never throws on partial failure. The frontend renders
  //   whatever is available and shows empty states for the rest.

  /**
   * Returns the patient's dashboard summary in a single round-trip.
   *
   * @param userId   The authenticated patient's user id.
   * @param clinicId The clinic context (from JWT / clinic context).
   */
  async getDashboardSummary(
    userId: string,
    clinicId?: string
  ): Promise<PatientDashboardSummaryDto> {
    if (!userId) {
      throw new Error('User ID is required');
    }

    if (
      !this.appointmentsService ||
      !this.ehrService ||
      !this.billingService ||
      !this.pharmacyService
    ) {
      // Defensive: the controller should never call this without the
      // module wiring. Tests can construct PatientsService without these
      // collaborators, in which case the endpoint returns empty.
      return {
        generatedAt: new Date().toISOString(),
        errors: { composition: 'dashboard-summary collaborators not wired' },
      };
    }

    const cacheKey = `patient:dashboard:summary:${userId}:${clinicId || 'all'}`;
    const tags: readonly string[] = [
      'patient_dashboard_summary',
      `user:${userId}`,
      ...(clinicId ? [`clinic:${clinicId}`] : []),
    ];

    return this.cacheService.cache(
      cacheKey,
      async () => this.composeDashboardSummary(userId, clinicId),
      {
        ttl: PatientsService.DASHBOARD_SUMMARY_TTL_SECONDS,
        staleTime: PatientsService.DASHBOARD_SUMMARY_STALE_SECONDS,
        tags,
        priority: 'high',
        enableSwr: true,
        containsPHI: true,
        compress: true,
        clinicSpecific: true,
      }
    );
  }

  /**
   * Invalidates dashboard summary cache for a user directly, by tag.
   *
   * NOTE: appointment lifecycle events already invalidate this cache without
   * calling this method — `CacheService.invalidateAppointmentCache()` tags
   * every appointment write with `user:${patientId}`, which this cache shares.
   * Payment/invoice writes similarly bust `user:${userId}` via
   * `BillingService`'s own invalidation helpers. Call this method directly
   * only for a write path that doesn't already go through one of those (e.g.
   * a new pharmacy/EHR event that should also refresh the dashboard).
   */
  async invalidateDashboardSummary(userId: string): Promise<void> {
    if (!userId) return;
    try {
      await this.cacheService.invalidateCacheByTag(`user:${userId}`);
      await this.cacheService.invalidateCacheByTag('patient_dashboard_summary');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Failed to invalidate dashboard summary cache: ${message}`,
        'PatientsService.invalidateDashboardSummary',
        { userId }
      );
    }
  }

  // ─────────────────────────── Internals ───────────────────────────

  private async composeDashboardSummary(
    userId: string,
    clinicId?: string
  ): Promise<PatientDashboardSummaryDto> {
    const errors: Record<string, string> = {};

    const [appointmentsResult, ehrResult, prescriptionsResult, invoicesResult, paymentsResult] =
      await Promise.all([
        this.timeDashboardCall('appointments', () =>
          this.fetchDashboardAppointments(userId, clinicId)
        ),
        this.timeDashboardCall('ehr', () =>
          this.ehrService!.getComprehensiveHealthRecord(userId, clinicId)
        ),
        this.timeDashboardCall('prescriptions', () =>
          // The dashboard is the patient's own view: their prescriptions of every clinic.
          this.pharmacyService!.findPrescriptionsByPatient(userId, { role: Role.PATIENT })
        ),
        this.timeDashboardCall('invoices', () =>
          this.billingService!.getUserInvoices(userId, Role.PATIENT, userId, clinicId)
        ),
        this.timeDashboardCall('payments', () =>
          this.billingService!.getUserPayments(userId, Role.PATIENT, userId, clinicId)
        ),
      ]);

    if (appointmentsResult.error) errors['appointments'] = appointmentsResult.error;
    if (ehrResult.error) errors['ehr'] = ehrResult.error;
    if (prescriptionsResult.error) errors['prescriptions'] = prescriptionsResult.error;
    if (invoicesResult.error) errors['invoices'] = invoicesResult.error;
    if (paymentsResult.error) errors['payments'] = paymentsResult.error;

    const durationsMs = {
      appointments: appointmentsResult.durationMs,
      ehr: ehrResult.durationMs,
      prescriptions: prescriptionsResult.durationMs,
      invoices: invoicesResult.durationMs,
      payments: paymentsResult.durationMs,
    };
    const slowestSubCall = Object.entries(durationsMs).sort((a, b) => b[1] - a[1])[0];

    await this.loggingService.log(
      LogType.SYSTEM,
      // Routine composition telemetry - always INFO. This fires on every
      // request, so tagging it WARN (as a prior revision did whenever the
      // slowest sub-call exceeded 2s) flooded the production terminal/docker
      // logs with a near-constant stream of "Composed for user X" lines,
      // drowning out actual warnings (cache misses, low cache hit rate).
      // It's still captured by the logger/events system regardless of level
      // (LoggingService stores every log in the cache before level-gating
      // terminal output), so timing data remains available on the logger
      // dashboard - it just doesn't spam the console.
      LogLevel.INFO,
      `[dashboard-summary] Composed for user ${userId}`,
      'PatientsService.composeDashboardSummary',
      {
        userId,
        clinicId,
        subCallErrors: Object.keys(errors),
        durationsMs,
        slowestSubCall: slowestSubCall ? `${slowestSubCall[0]}:${slowestSubCall[1]}ms` : undefined,
        hasAppointments:
          Array.isArray(appointmentsResult.data) && appointmentsResult.data.length > 0,
        hasPrescriptions:
          Array.isArray(prescriptionsResult.data) && prescriptionsResult.data.length > 0,
        hasInvoices: Array.isArray(invoicesResult.data) && invoicesResult.data.length > 0,
      }
    );

    const summary: PatientDashboardSummaryDto = {
      generatedAt: new Date().toISOString(),
      ...(Object.keys(errors).length > 0 ? { errors } : {}),
      ...(appointmentsResult.data !== undefined ? { appointments: appointmentsResult.data } : {}),
      ...(prescriptionsResult.data !== undefined
        ? { prescriptions: prescriptionsResult.data }
        : {}),
      ...(ehrResult.data !== undefined ? { comprehensive: ehrResult.data } : {}),
      ...(invoicesResult.data !== undefined ? { invoices: invoicesResult.data } : {}),
      ...(paymentsResult.data !== undefined ? { payments: paymentsResult.data } : {}),
    };

    return summary;
  }

  /**
   * Wraps a sub-call so that a single failure (timeout, DB error, etc.)
   * doesn't fail the whole summary. Returns `{ data }` on success or
   * `{ error: <message> }` on failure.
   */
  private async safeDashboardCall<T>(
    name: string,
    fn: () => Promise<T>
  ): Promise<{ data?: T; error?: string }> {
    try {
      const data = await fn();
      return { data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `[dashboard-summary] sub-call "${name}" failed: ${message}`,
        'PatientsService.safeDashboardCall',
        { name, message }
      );
      return { error: message };
    }
  }

  /** Same as {@link safeDashboardCall}, plus wall-clock duration so callers
   *  can identify which of the 5 parallel sub-calls dominates a slow
   *  dashboard-summary composition. */
  private async timeDashboardCall<T>(
    name: string,
    fn: () => Promise<T>
  ): Promise<{ data?: T; error?: string; durationMs: number }> {
    const startedAt = Date.now();
    const result = await this.safeDashboardCall(name, fn);
    return { ...result, durationMs: Date.now() - startedAt };
  }

  /**
   * Fetches non-terminal appointments (SCHEDULED / CONFIRMED / IN_PROGRESS)
   * for the patient. Pulls up to 20 most-recent items; the dashboard only
   * surfaces a handful but over-fetching slightly keeps the data stable
   * across re-renders. Returned items are de-duplicated by id defensively.
   */
  private async fetchDashboardAppointments(userId: string, clinicId?: string): Promise<unknown[]> {
    if (!clinicId || !this.appointmentsService) {
      return [];
    }

    // Use the PATIENT-scoped path that bypasses the role-cached list and
    // goes straight through coreAppointmentService. The service handles
    // RBAC + patient resolution for us.
    const result = await this.appointmentsService.getAppointments(
      {
        patientId: userId,
        clinicId,
      } as never,
      userId,
      clinicId,
      Role.PATIENT,
      1,
      20
    );

    const response = result as unknown as {
      data?: unknown[] | { appointments?: unknown[] };
      appointments?: unknown[];
    };
    const raw = Array.isArray(response.data)
      ? response.data
      : Array.isArray(response.data?.appointments)
        ? response.data.appointments
        : Array.isArray(response.appointments)
          ? response.appointments
          : [];

    // De-duplicate by id defensively (some upstream queries can return
    // duplicates due to joined relations).
    const seen = new Set<string>();
    const deduped: unknown[] = [];
    for (const item of raw as Array<{ id?: string }>) {
      const id = String(item?.id || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      deduped.push(item);
    }
    return deduped;
  }
}
