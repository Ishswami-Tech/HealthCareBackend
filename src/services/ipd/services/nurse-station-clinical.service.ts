/**
 * Nurse Station Service - Vitals, Notes, and Medication Administration
 * @module Nurse Station - Clinical Service
 * @description Handles nursing notes, vitals recording, and bedside medication administration
 */

import { Injectable } from '@nestjs/common';
import type {
  CreateNursingNoteDto,
  NursingNotesQueryDto,
  RecordVitalsDto,
  AdministerMedicationDto,
  NursingNoteResponseDto,
  VitalsResponseDto,
  BedsideMedicationResponseDto,
} from '@services/ipd/dto';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareErrorsService } from '@core/errors/healthcare-errors.service';

const NURSE_STATION_CACHE_PREFIX = 'ipd:nurse-station';

type AdmissionLookup = {
  id: string;
  patientId: string;
  clinicLocationId: string;
  status: string;
};

type NoteRecord = {
  id: string;
  clinicId: string;
  clinicLocationId: string;
  admissionId: string;
  patientId: string;
  nurseId?: string | null | undefined;
  severity: string;
  content: string;
  doctorAcknowledged?: boolean | null | undefined;
  acknowledgedById?: string | null | undefined;
  acknowledgedAt?: Date | null | undefined;
  notes?: string | null | undefined;
  createdAt: Date;
  updatedAt: Date;
  recordedByUser?: { name?: string | null } | null | undefined;
};

type VitalsRecord = {
  id: string;
  clinicId: string;
  clinicLocationId: string;
  admissionId: string;
  patientId: string;
  bpSystolic?: number | null;
  bpDiastolic?: number | null;
  heartRate?: number | null;
  temperature?: number | null;
  respiratoryRate?: number | null;
  oxygenSaturation?: number | null;
  bloodGlucose?: number | null;
  weight?: number | null;
  height?: number | null;
  bmi?: number | null;
  painScore?: number | null;
  recordedBy: string;
  notes?: string | null;
  recordedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  recordedByUser?: { name?: string | null } | null;
};

type MedicationRecord = {
  id: string;
  clinicId: string;
  clinicLocationId: string;
  admissionId: string;
  patientId: string;
  medicationName: string;
  dosage: string;
  route: string;
  frequency?: string | null;
  administeredBy: string;
  verifiedById?: string | null;
  administeredAt: Date;
  batchNumber?: string | null;
  adverseReactions?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
  administeredByUser?: { name?: string | null } | null;
  verifiedByUser?: { name?: string | null } | null;
};

@Injectable()
export class NurseStationClinicalService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: LoggingService,
    private readonly events: EventService,
    private readonly errorsService: HealthcareErrorsService
  ) {}

  async createNursingNote(
    dto: CreateNursingNoteDto,
    clinicId: string
  ): Promise<NursingNoteResponseDto> {
    const admission = await this.getOpenAdmission(dto.admissionId, clinicId, 'createNursingNote');

    const note = await this.db.prisma.nursingNote.create({
      data: {
        clinicId,
        clinicLocationId: admission.clinicLocationId,
        admissionId: dto.admissionId,
        patientId: admission.patientId,
        severity: dto.severity,
        content: dto.content,
        recordedBy: dto.nurseId,
      } as never,
    });

    await this.invalidateCaches(clinicId, admission.clinicLocationId, dto.admissionId);
    await this.events.emit('ipd.nursingNoteCreated', {
      noteId: note.id,
      admissionId: dto.admissionId,
      patientId: admission.patientId,
      clinicId,
      clinicLocationId: admission.clinicLocationId,
      nurseId: dto.nurseId,
    });

    return this.mapNursingNoteToDto({
      ...note,
      doctorAcknowledged: false,
      acknowledgedById: null,
      acknowledgedAt: null,
      recordedByUser: undefined,
    });
  }

  async getNursingNotes(
    clinicId: string,
    query: NursingNotesQueryDto
  ): Promise<{ data: NursingNoteResponseDto[]; total: number; page: number; limit: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: {
      clinicId: string;
      admissionId?: string;
      patientId?: string;
      severity?: string;
    } = { clinicId };

    if (query.admissionId) {
      where.admissionId = query.admissionId;
    }

    if (query.patientId) {
      where.patientId = query.patientId;
    }

    if (query.severity) {
      where.severity = query.severity;
    }

    const [notes, total] = await Promise.all([
      this.db.prisma.nursingNote.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.db.prisma.nursingNote.count({ where }),
    ]);

    return {
      data: notes.map(note =>
        this.mapNursingNoteToDto({
          ...note,
          doctorAcknowledged: false,
          acknowledgedById: null,
          acknowledgedAt: null,
          recordedByUser: undefined,
        })
      ),
      total,
      page,
      limit,
    };
  }

  async acknowledgeNursingNote(
    noteId: string,
    doctorId: string,
    clinicId: string
  ): Promise<NursingNoteResponseDto> {
    const note = await this.db.prisma.nursingNote.findFirst({
      where: { id: noteId, clinicId },
    });

    if (!note) {
      throw this.errorsService.ipdAdmissionNotFound(
        noteId,
        'NurseStationClinicalService.acknowledgeNursingNote'
      );
    }

    await this.events.emit('ipd.nursingNoteAcknowledged', {
      noteId,
      clinicId,
      acknowledgedBy: doctorId,
    });

    return this.mapNursingNoteToDto({
      ...note,
      doctorAcknowledged: true,
      acknowledgedById: doctorId,
      acknowledgedAt: new Date(),
      recordedByUser: undefined,
    });
  }

  async recordVitals(dto: RecordVitalsDto, clinicId: string): Promise<VitalsResponseDto> {
    const admission = await this.getOpenAdmission(dto.admissionId, clinicId, 'recordVitals');

    const vitals = await this.db.prisma.vitalsFlowsheet.create({
      data: {
        clinicId,
        clinicLocationId: admission.clinicLocationId,
        admissionId: dto.admissionId,
        patientId: admission.patientId,
        bpSystolic: dto.bpSystolic,
        bpDiastolic: dto.bpDiastolic,
        heartRate: dto.heartRate,
        temperature: dto.temperature,
        respiratoryRate: dto.respiratoryRate,
        oxygenSaturation: dto.oxygenSaturation,
        bloodGlucose: dto.bloodGlucose,
        weight: dto.weight,
        height: dto.height,
        painScore: dto.painScore,
        recordedBy: dto.recordedBy,
        notes: dto.notes,
        recordedAt: new Date(),
      } as never,
      include: {
        recordedByUser: { select: { name: true } },
      },
    });

    await this.invalidateCaches(clinicId, admission.clinicLocationId, dto.admissionId);
    await this.events.emit('ipd.vitalsRecorded', {
      vitalsId: vitals.id,
      admissionId: dto.admissionId,
      patientId: admission.patientId,
      clinicId,
      clinicLocationId: admission.clinicLocationId,
      recordedBy: dto.recordedBy,
    });

    return this.mapVitalsToDto(vitals as VitalsRecord);
  }

  async getVitalsHistory(admissionId: string, clinicId: string): Promise<VitalsResponseDto[]> {
    const vitals = await this.db.prisma.vitalsFlowsheet.findMany({
      where: { admissionId, clinicId },
      orderBy: { recordedAt: 'desc' },
      include: {
        recordedByUser: { select: { name: true } },
      },
    });

    return vitals.map(entry => this.mapVitalsToDto(entry as VitalsRecord));
  }

  async administerMedication(
    dto: AdministerMedicationDto,
    clinicId: string
  ): Promise<BedsideMedicationResponseDto> {
    const admission = await this.getOpenAdmission(
      dto.admissionId,
      clinicId,
      'administerMedication'
    );

    const medication = await this.db.prisma.bedsideMedication.create({
      data: {
        clinicId,
        clinicLocationId: admission.clinicLocationId,
        admissionId: dto.admissionId,
        patientId: admission.patientId,
        medicationName: dto.medicationName,
        dosage: dto.dosage,
        route: dto.route,
        frequency: dto.frequency,
        administeredBy: dto.administeredBy,
        verifiedById: dto.verifiedBy,
        administeredAt: new Date(dto.administeredAt ?? new Date().toISOString()),
        batchNumber: dto.batchNumber,
        adverseReactions: dto.adverseReactions,
        notes: dto.notes,
      } as never,
      include: {
        administeredByUser: { select: { name: true } },
        verifiedByUser: { select: { name: true } },
      },
    });

    await this.invalidateCaches(clinicId, admission.clinicLocationId, dto.admissionId);
    await this.events.emit('ipd.medicationAdministered', {
      medicationId: medication.id,
      admissionId: dto.admissionId,
      patientId: admission.patientId,
      clinicId,
      clinicLocationId: admission.clinicLocationId,
      administeredBy: dto.administeredBy,
      verifiedBy: dto.verifiedBy,
    });

    return this.mapMedicationToDto(medication as MedicationRecord);
  }

  async getMedicationHistory(
    admissionId: string,
    clinicId: string
  ): Promise<BedsideMedicationResponseDto[]> {
    const medications = await this.db.prisma.bedsideMedication.findMany({
      where: { admissionId, clinicId },
      orderBy: { administeredAt: 'desc' },
      include: {
        administeredByUser: { select: { name: true } },
        verifiedByUser: { select: { name: true } },
      },
    });

    return medications.map(entry => this.mapMedicationToDto(entry as MedicationRecord));
  }

  private async getOpenAdmission(
    admissionId: string,
    clinicId: string,
    context: string
  ): Promise<AdmissionLookup> {
    const admission = await this.db.prisma.admission.findFirst({
      where: { id: admissionId, clinicId, status: { not: 'DISCHARGED' } },
      select: { id: true, patientId: true, clinicLocationId: true, status: true },
    });

    if (!admission) {
      throw this.errorsService.ipdAdmissionNotFound(
        admissionId,
        `NurseStationClinicalService.${context}`
      );
    }

    return admission;
  }

  private mapNursingNoteToDto(note: NoteRecord): NursingNoteResponseDto {
    return {
      id: note.id,
      clinicId: note.clinicId,
      clinicLocationId: note.clinicLocationId,
      admissionId: note.admissionId,
      patientId: note.patientId,
      nurseId: note.nurseId ?? '',
      nurseName: note.recordedByUser?.name ?? undefined,
      content: note.content,
      severity: note.severity,
      doctorAcknowledged: note.doctorAcknowledged ?? false,
      acknowledgedById: note.acknowledgedById ?? undefined,
      acknowledgedAt: note.acknowledgedAt?.toISOString(),
      notes: note.notes ?? undefined,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }

  private mapVitalsToDto(vitals: VitalsRecord): VitalsResponseDto {
    return {
      id: vitals.id,
      clinicId: vitals.clinicId,
      clinicLocationId: vitals.clinicLocationId,
      admissionId: vitals.admissionId,
      patientId: vitals.patientId,
      bpSystolic: vitals.bpSystolic ?? undefined,
      bpDiastolic: vitals.bpDiastolic ?? undefined,
      heartRate: vitals.heartRate ?? undefined,
      temperature: vitals.temperature ?? undefined,
      respiratoryRate: vitals.respiratoryRate ?? undefined,
      oxygenSaturation: vitals.oxygenSaturation ?? undefined,
      bloodGlucose: vitals.bloodGlucose ?? undefined,
      weight: vitals.weight ?? undefined,
      height: vitals.height ?? undefined,
      bmi: vitals.bmi ?? undefined,
      painScore: vitals.painScore ?? undefined,
      recordedBy: vitals.recordedBy,
      recordedByName: vitals.recordedByUser?.name ?? undefined,
      notes: vitals.notes ?? undefined,
      recordedAt: vitals.recordedAt.toISOString(),
      createdAt: vitals.createdAt.toISOString(),
    };
  }

  private mapMedicationToDto(medication: MedicationRecord): BedsideMedicationResponseDto {
    return {
      id: medication.id,
      clinicId: medication.clinicId,
      clinicLocationId: medication.clinicLocationId,
      admissionId: medication.admissionId,
      patientId: medication.patientId,
      medicationName: medication.medicationName,
      dosage: medication.dosage,
      route: medication.route,
      frequency: medication.frequency ?? undefined,
      administeredBy: medication.administeredBy,
      administeredByName: medication.administeredByUser?.name ?? undefined,
      verifiedById: medication.verifiedById ?? undefined,
      verifiedByName: medication.verifiedByUser?.name ?? undefined,
      administeredAt: medication.administeredAt.toISOString(),
      batchNumber: medication.batchNumber ?? undefined,
      adverseReactions: medication.adverseReactions ?? undefined,
      notes: medication.notes ?? undefined,
      createdAt: medication.createdAt.toISOString(),
    };
  }

  private async invalidateCaches(
    clinicId: string,
    clinicLocationId: string,
    admissionId: string
  ): Promise<void> {
    const patterns = [
      `${NURSE_STATION_CACHE_PREFIX}:notes:${clinicId}:${clinicLocationId}:${admissionId}:*`,
      `${NURSE_STATION_CACHE_PREFIX}:vitals:${clinicId}:${clinicLocationId}:${admissionId}:*`,
      `${NURSE_STATION_CACHE_PREFIX}:medications:${clinicId}:${clinicLocationId}:${admissionId}:*`,
    ];

    for (const pattern of patterns) {
      await this.cache.invalidatePattern(pattern);
    }
  }
}
