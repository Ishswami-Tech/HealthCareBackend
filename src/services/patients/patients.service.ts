import { ForbiddenException, Injectable, Inject, forwardRef } from '@nestjs/common';
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

@Injectable()
export class PatientsService {
  /** Dashboard-summary cache TTL — 60s. Low enough to bound staleness on
   *  missed realtime events, high enough to absorb the dashboard's heavy
   *  refetch pattern (focus, mount, etc). */
  private static readonly DASHBOARD_SUMMARY_TTL_SECONDS = 60;

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
    private readonly pharmacyService?: PharmacyService
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

          const existingInsurance = (await typedClient.insurance.findFirst({
            where: {
              userId: userId,
              ...(effectiveClinicId ? { clinicId: effectiveClinicId } : {}),
            } as PrismaDelegateArgs,
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
                ...(effectiveClinicId ? { clinicId: effectiveClinicId } : {}),
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
                ...(effectiveClinicId ? { clinicId: effectiveClinicId } : {}),
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

          const existingContact = (await typedClient.emergencyContact.findFirst({
            where: {
              userId: userId,
              ...(effectiveClinicId ? { clinicId: effectiveClinicId } : {}),
            } as PrismaDelegateArgs,
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
                ...(effectiveClinicId ? { clinicId: effectiveClinicId } : {}),
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

  /**
   * Upload patient document and create health record
   */
  async uploadPatientDocument(patientId: string, file: MulterFile, auditInfo: AuditInfo) {
    const scopedPatient = await this.getPatientRecordForClinic(patientId, auditInfo.clinicId);

    if (!scopedPatient) {
      throw new ForbiddenException('Patient does not belong to your clinic');
    }

    if (
      auditInfo.userRole === String(Role.PATIENT) &&
      auditInfo.userId &&
      scopedPatient.userId !== auditInfo.userId
    ) {
      throw new ForbiddenException('You can only upload documents to your own record');
    }

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
            patientId: scopedPatient.id,
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
   * Invalidates dashboard summary cache for a user. Called from
   * billing.events.ts and any other event listener that should bust
   * the cache on lifecycle events (e.g. appointment.completed,
   * invoice.paid, payment.completed, prescription.dispensed).
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
        this.safeDashboardCall('appointments', () =>
          this.fetchDashboardAppointments(userId, clinicId)
        ),
        this.safeDashboardCall('ehr', () =>
          this.ehrService!.getComprehensiveHealthRecord(userId, clinicId)
        ),
        this.safeDashboardCall('prescriptions', () =>
          this.pharmacyService!.findPrescriptionsByPatient(userId)
        ),
        this.safeDashboardCall('invoices', () =>
          this.billingService!.getUserInvoices(userId, Role.PATIENT, userId, clinicId)
        ),
        this.safeDashboardCall('payments', () =>
          this.billingService!.getUserPayments(userId, Role.PATIENT, userId, clinicId)
        ),
      ]);

    if (appointmentsResult.error) errors['appointments'] = appointmentsResult.error;
    if (ehrResult.error) errors['ehr'] = ehrResult.error;
    if (prescriptionsResult.error) errors['prescriptions'] = prescriptionsResult.error;
    if (invoicesResult.error) errors['invoices'] = invoicesResult.error;
    if (paymentsResult.error) errors['payments'] = paymentsResult.error;

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      `[dashboard-summary] Composed for user ${userId}`,
      'PatientsService.composeDashboardSummary',
      {
        userId,
        clinicId,
        subCallErrors: Object.keys(errors),
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
