/**
 * IPD Admission Service
 * @module Admission Service
 * @description Handles patient admission, bed transfer, discharge, and admission lookups
 */

import { Injectable } from '@nestjs/common';
import type {
  AdmitPatientDto,
  TransferBedDto,
  DischargePatientDto,
  AdmissionResponseDto,
  AdmissionStatus,
} from '@services/ipd/dto';
import {
  AdmissionStatus as AdmissionStatusEnum,
  BedStatus as BedStatusEnum,
  DischargeType,
} from '@services/ipd/dto';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';
import { HealthcareErrorsService } from '@core/errors/healthcare-errors.service';
import { formatDateKeyInIST } from '@utils/date-time.util';
import { startOfIstDay } from '@utils/clock.util';

const ADMISSION_CACHE_PREFIX = 'ipd:admission';

type AdmissionUserSummary = {
  name: string;
  firstName?: string | null;
  lastName?: string | null;
};

type AdmissionPatientSummary = {
  user?: AdmissionUserSummary | null | undefined;
};

type AdmissionWardSummary = {
  name: string;
  wardType?: string | null;
};

type AdmissionBedSummary = {
  bedNumber: string;
  roomNumber?: string | null;
};

type AdmissionRecord = {
  id: string;
  admissionNumber: string;
  patientId: string;
  clinicId: string;
  clinicLocationId: string;
  wardId: string;
  bedId: string;
  admittingDoctorId: string;
  status: string;
  admittedAt: Date;
  primaryDiagnosis?: string | null;
  secondaryDiagnoses?: unknown;
  admissionReason: string;
  expectedDischargeDate?: Date | null;
  referringDoctor?: string | null;
  attendantName?: string | null;
  attendantPhone?: string | null;
  insuranceDetails?: unknown;
  notes?: string | null;
  dischargedAt?: Date | null;
  dischargeType?: string | null;
  dischargedById?: string | null;
  finalDiagnosis?: string | null;
  treatmentSummary?: string | null;
  followUpInstructions?: string | null;
  followUpDate?: Date | null;
  dischargeMedications?: unknown;
  dischargeAdvice?: string | null;
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
  patient?: AdmissionPatientSummary | null | undefined;
  ward?: AdmissionWardSummary | null | undefined;
  bed?: AdmissionBedSummary | null | undefined;
};

@Injectable()
export class AdmissionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: LoggingService,
    private readonly events: EventService,
    private readonly errorsService: HealthcareErrorsService
  ) {}

  async admitPatient(
    dto: AdmitPatientDto,
    userId: string,
    clinicId: string,
    clinicLocationId: string
  ): Promise<AdmissionResponseDto> {
    const bed = await this.db.prisma.bed.findFirst({
      where: {
        id: dto.bedId,
        clinicId,
        clinicLocationId,
        wardId: dto.wardId,
      },
      include: { ward: true },
    });

    if (!bed) {
      throw this.errorsService.ipdBedNotFound(dto.bedId, 'AdmissionService.admitPatient');
    }

    if (bed.status !== BedStatusEnum.AVAILABLE) {
      throw this.errorsService.ipdBedNotAvailable(
        bed.bedNumber,
        String(bed.status),
        'AdmissionService.admitPatient'
      );
    }

    const activeAdmission = await this.db.prisma.admission.findFirst({
      where: {
        patientId: dto.patientId,
        clinicId,
        clinicLocationId,
        status: { in: [AdmissionStatusEnum.ADMITTED, AdmissionStatusEnum.TRANSFERRED] },
      },
    });

    if (activeAdmission) {
      throw this.errorsService.ipdPatientAlreadyAdmitted(
        activeAdmission.admissionNumber,
        'AdmissionService.admitPatient'
      );
    }

    const admissionNumber = await this.generateAdmissionNumber(clinicId);

    const admission = await this.db.prisma.$transaction(async tx => {
      const created = await tx.admission.create({
        data: {
          admissionNumber,
          patientId: dto.patientId,
          clinicId,
          clinicLocationId,
          wardId: dto.wardId,
          bedId: dto.bedId,
          admittingDoctorId: dto.admittingDoctorId,
          status: AdmissionStatusEnum.ADMITTED,
          admittedAt: new Date(),
          primaryDiagnosis: dto.primaryDiagnosis,
          secondaryDiagnoses: dto.secondaryDiagnoses ?? [],
          admissionReason: dto.admissionReason,
          expectedDischargeDate: dto.expectedDischargeDate
            ? new Date(dto.expectedDischargeDate)
            : null,
          referringDoctor: dto.referringDoctor,
          attendantName: dto.attendantName,
          attendantPhone: dto.attendantPhone,
          insuranceDetails: dto.insuranceDetails ?? null,
          notes: dto.notes,
          createdBy: userId,
        } as never,
      });

      await tx.bedAssignment.create({
        data: {
          admissionId: created.id,
          bedId: dto.bedId,
          wardId: dto.wardId,
          assignedAt: new Date(),
          isActive: true,
          authorizedBy: userId,
        },
      });

      await tx.bed.update({
        where: { id: dto.bedId },
        data: { status: BedStatusEnum.OCCUPIED },
      });

      return created;
    });

    await this.invalidateCaches(clinicId, clinicLocationId, dto.patientId);
    await this.events.emit('ipd.admitted', {
      admissionId: admission.id,
      patientId: dto.patientId,
      clinicId,
      clinicLocationId,
      wardId: dto.wardId,
      bedId: dto.bedId,
      admittedBy: userId,
    });

    return this.mapAdmissionToDto({
      ...admission,
      patient: undefined,
      ward: bed.ward ? { name: bed.ward.name, wardType: bed.ward.wardType } : undefined,
      bed: {
        bedNumber: bed.bedNumber,
        roomNumber: bed.roomNumber,
      },
    });
  }

  async getAdmissionById(
    admissionId: string,
    clinicId: string,
    clinicLocationId: string
  ): Promise<AdmissionResponseDto> {
    const cacheKey = `${ADMISSION_CACHE_PREFIX}:detail:${clinicId}:${clinicLocationId}:${admissionId}`;
    const cached = await this.cache.get<AdmissionResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const admission = await this.db.prisma.admission.findFirst({
      where: { id: admissionId, clinicId, clinicLocationId },
      include: {
        patient: {
          include: {
            user: {
              select: { name: true, firstName: true, lastName: true },
            },
          },
        },
        ward: true,
        bed: true,
      },
    });

    if (!admission) {
      throw new HealthcareError('Admission not found', ErrorCode.RESOURCE_NOT_FOUND, {
        admissionId,
      });
    }

    const result = this.mapAdmissionToDto(admission as AdmissionRecord);
    await this.cache.set(cacheKey, result, 300);
    return result;
  }

  async getActiveAdmissions(
    clinicId: string,
    clinicLocationId: string
  ): Promise<AdmissionResponseDto[]> {
    const cacheKey = `${ADMISSION_CACHE_PREFIX}:active:${clinicId}:${clinicLocationId}`;
    const cached = await this.cache.get<AdmissionResponseDto[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const admissions = await this.db.prisma.admission.findMany({
      where: {
        clinicId,
        clinicLocationId,
        status: {
          in: [AdmissionStatusEnum.ADMITTED, AdmissionStatusEnum.TRANSFERRED],
        },
      },
      orderBy: { admittedAt: 'desc' },
      include: {
        patient: {
          include: {
            user: {
              select: { name: true, firstName: true, lastName: true },
            },
          },
        },
        ward: true,
        bed: true,
      },
    });

    const result = admissions.map(admission =>
      this.mapAdmissionToDto(admission as AdmissionRecord)
    );
    await this.cache.set(cacheKey, result, 300);
    return result;
  }

  async transferBed(
    admissionId: string,
    dto: TransferBedDto,
    clinicId: string,
    clinicLocationId: string
  ): Promise<AdmissionResponseDto> {
    const admission = await this.db.prisma.admission.findFirst({
      where: { id: admissionId, clinicId, clinicLocationId },
    });

    if (!admission) {
      throw new HealthcareError('Admission not found', ErrorCode.RESOURCE_NOT_FOUND, {
        admissionId,
      });
    }

    if (
      [
        AdmissionStatusEnum.DISCHARGED,
        AdmissionStatusEnum.AMA,
        AdmissionStatusEnum.LAMA,
        AdmissionStatusEnum.EXPIRED,
      ].includes(admission.status as AdmissionStatus)
    ) {
      throw this.errorsService.ipdTransferInvalidStatus(
        String(admission.status),
        'AdmissionService.transferBed'
      );
    }

    const targetBed = await this.db.prisma.bed.findFirst({
      where: {
        id: dto.toBedId,
        clinicId,
        clinicLocationId,
        wardId: dto.toWardId,
      },
      include: { ward: true },
    });

    if (!targetBed) {
      throw this.errorsService.ipdTargetBedNotFound(dto.toBedId, 'AdmissionService.transferBed');
    }

    if (targetBed.status !== BedStatusEnum.AVAILABLE) {
      throw this.errorsService.ipdTargetBedNotAvailable(
        targetBed.bedNumber,
        String(targetBed.status),
        'AdmissionService.transferBed'
      );
    }

    const updated = await this.db.prisma.$transaction(async tx => {
      await tx.bedAssignment.updateMany({
        where: { admissionId, isActive: true },
        data: { releasedAt: new Date(), isActive: false },
      });

      await tx.bed.update({
        where: { id: admission.bedId },
        data: { status: BedStatusEnum.CLEANING },
      });

      await tx.bedAssignment.create({
        data: {
          admissionId,
          bedId: dto.toBedId,
          wardId: dto.toWardId,
          assignedAt: new Date(),
          isActive: true,
          transferReason: dto.transferReason,
          authorizedBy: dto.authorizedBy,
        },
      });

      await tx.bed.update({
        where: { id: dto.toBedId },
        data: { status: BedStatusEnum.OCCUPIED },
      });

      return tx.admission.update({
        where: { id: admissionId },
        data: {
          wardId: dto.toWardId,
          bedId: dto.toBedId,
          status: AdmissionStatusEnum.TRANSFERRED,
        } as never,
      });
    });

    await this.invalidateCaches(clinicId, clinicLocationId, admission.patientId);
    await this.events.emit('ipd.bedTransferred', {
      admissionId,
      patientId: admission.patientId,
      clinicId,
      clinicLocationId,
      fromBedId: admission.bedId,
      toBedId: dto.toBedId,
      reason: dto.transferReason,
    });

    return this.mapAdmissionToDto({
      ...updated,
      patient: undefined,
      ward: targetBed.ward
        ? { name: targetBed.ward.name, wardType: targetBed.ward.wardType }
        : undefined,
      bed: {
        bedNumber: targetBed.bedNumber,
        roomNumber: targetBed.roomNumber,
      },
    } as AdmissionRecord);
  }

  async dischargePatient(
    admissionId: string,
    dto: DischargePatientDto,
    clinicId: string,
    clinicLocationId: string
  ): Promise<AdmissionResponseDto> {
    const admission = await this.db.prisma.admission.findFirst({
      where: { id: admissionId, clinicId, clinicLocationId },
    });

    if (!admission) {
      throw new HealthcareError('Admission not found', ErrorCode.RESOURCE_NOT_FOUND, {
        admissionId,
      });
    }

    if (admission.status === AdmissionStatusEnum.DISCHARGED) {
      throw this.errorsService.ipdAlreadyDischarged('AdmissionService.dischargePatient');
    }

    const newStatus = this.mapDischargeTypeToStatus(dto.dischargeType);

    const updated = await this.db.prisma.$transaction(async tx => {
      await tx.bedAssignment.updateMany({
        where: { admissionId, isActive: true },
        data: { releasedAt: new Date(), isActive: false },
      });

      await tx.bed.update({
        where: { id: admission.bedId },
        data: { status: BedStatusEnum.CLEANING },
      });

      return tx.admission.update({
        where: { id: admissionId },
        data: {
          status: newStatus,
          dischargedAt: new Date(),
          dischargeType: dto.dischargeType,
          dischargedById: dto.dischargedBy,
          finalDiagnosis: dto.finalDiagnosis,
          treatmentSummary: dto.treatmentSummary,
          followUpInstructions: dto.followUpInstructions,
          followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : null,
          dischargeMedications: dto.dischargeMedications ?? [],
          dischargeAdvice: dto.dischargeAdvice,
        } as never,
      });
    });

    await this.invalidateCaches(clinicId, clinicLocationId, admission.patientId);
    await this.events.emit('ipd.discharged', {
      admissionId,
      patientId: admission.patientId,
      clinicId,
      clinicLocationId,
      dischargeType: dto.dischargeType,
      dischargedAt: updated.dischargedAt,
      dischargedBy: dto.dischargedBy,
    });

    return this.mapAdmissionToDto(updated as AdmissionRecord);
  }

  private async generateAdmissionNumber(clinicId: string): Promise<string> {
    const today = new Date();
    const datePrefix = formatDateKeyInIST(today).replace(/-/g, '');

    const todayCount = await this.db.prisma.admission.count({
      where: {
        clinicId,
        admittedAt: {
          gte: startOfIstDay(today) ?? today,
        },
      },
    });

    const sequence = String(todayCount + 1).padStart(5, '0');
    return `IPD-${datePrefix}-${sequence}`;
  }

  private mapDischargeTypeToStatus(dischargeType: DischargeType): AdmissionStatus {
    const mapping: Record<DischargeType, AdmissionStatus> = {
      [DischargeType.REGULAR]: AdmissionStatusEnum.DISCHARGED,
      [DischargeType.TRANSFER]: AdmissionStatusEnum.TRANSFERRED,
      [DischargeType.AGAINST_MEDICAL_ADVICE]: AdmissionStatusEnum.AMA,
      [DischargeType.LEFT_AGAINST_ADVICE]: AdmissionStatusEnum.LAMA,
      [DischargeType.EXPIRED]: AdmissionStatusEnum.EXPIRED,
    };

    return mapping[dischargeType];
  }

  private mapAdmissionToDto(admission: AdmissionRecord): AdmissionResponseDto {
    return {
      id: admission.id,
      admissionNumber: admission.admissionNumber,
      patientId: admission.patientId,
      patientName: this.buildDisplayName(admission.patient?.user),
      clinicId: admission.clinicId,
      clinicLocationId: admission.clinicLocationId,
      wardId: admission.wardId,
      wardName: admission.ward?.name,
      wardType: admission.ward?.wardType ?? undefined,
      bedId: admission.bedId,
      bedNumber: admission.bed?.bedNumber,
      roomNumber: admission.bed?.roomNumber ?? undefined,
      admittingDoctorId: admission.admittingDoctorId,
      admittingDoctorName: undefined,
      status: admission.status,
      admittedAt: admission.admittedAt.toISOString(),
      primaryDiagnosis: admission.primaryDiagnosis ?? undefined,
      secondaryDiagnoses: Array.isArray(admission.secondaryDiagnoses)
        ? (admission.secondaryDiagnoses as string[])
        : undefined,
      admissionReason: admission.admissionReason,
      expectedDischargeDate: admission.expectedDischargeDate?.toISOString(),
      referringDoctor: admission.referringDoctor ?? undefined,
      attendantName: admission.attendantName ?? undefined,
      attendantPhone: admission.attendantPhone ?? undefined,
      insuranceDetails:
        (admission.insuranceDetails as
          Record<string, unknown> | Array<Record<string, unknown>> | null) ?? null,
      notes: admission.notes ?? undefined,
      dischargedAt: admission.dischargedAt?.toISOString(),
      dischargeType: admission.dischargeType ?? undefined,
      dischargedById: admission.dischargedById ?? undefined,
      finalDiagnosis: admission.finalDiagnosis ?? undefined,
      treatmentSummary: admission.treatmentSummary ?? undefined,
      followUpInstructions: admission.followUpInstructions ?? undefined,
      followUpDate: admission.followUpDate?.toISOString(),
      dischargeMedications: Array.isArray(admission.dischargeMedications)
        ? (admission.dischargeMedications as AdmissionResponseDto['dischargeMedications'])
        : undefined,
      dischargeAdvice: admission.dischargeAdvice ?? undefined,
      createdBy: admission.createdBy ?? undefined,
      createdAt: admission.createdAt.toISOString(),
      updatedAt: admission.updatedAt.toISOString(),
    };
  }

  private buildDisplayName(user?: AdmissionUserSummary | null): string | undefined {
    if (!user) {
      return undefined;
    }

    const name = user.name?.trim();
    if (name) {
      return name;
    }

    const parts = [user.firstName, user.lastName].filter((part): part is string =>
      Boolean(part?.trim())
    );
    return parts.length > 0 ? parts.join(' ') : undefined;
  }

  private async invalidateCaches(
    clinicId: string,
    clinicLocationId: string,
    patientId: string
  ): Promise<void> {
    const patterns = [
      `${ADMISSION_CACHE_PREFIX}:active:${clinicId}:${clinicLocationId}`,
      `${ADMISSION_CACHE_PREFIX}:detail:${clinicId}:${clinicLocationId}:*`,
      `${ADMISSION_CACHE_PREFIX}:patient:${clinicId}:${clinicLocationId}:${patientId}`,
      `ipd:bedboard:${clinicId}:${clinicLocationId}:*`,
      `ipd:bedboard:bed:${clinicId}:${clinicLocationId}:*`,
      `ipd:ward:*:${clinicId}:${clinicLocationId}:*`,
    ];

    for (const pattern of patterns) {
      await this.cache.invalidatePattern(pattern);
    }
  }
}
