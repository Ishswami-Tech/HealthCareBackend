/**
 * Patient Visits Service
 * @module PatientVisits
 * @description OPD registration (per-visit OPD number, clinic-scoped sequence)
 * and the visit-scoped case-sheet aggregate.
 */

import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';
import { LogLevel, LogType } from '@core/types';
import { Role } from '@core/types/enums.types';
import type {
  PrismaDelegateArgs,
  PrismaTransactionClientWithDelegates,
} from '@core/types/prisma.types';
import type {
  CreatePatientVisitDto,
  PatientVisitResponse,
  SpecialCaseFlag,
  UpdatePatientVisitDto,
  VisitVitalsExaminationResponse,
} from '@dtos/patient-visit.dto';
import type { ClassicalExamFindingResponse } from '@services/ayurveda/dto/classical-exam.dto';
import { ClassicalExamService } from '@services/ayurveda/services/classical-exam.service';
import { PhiAuditService } from '@services/compliance/services/phi-audit.service';
import { UhidAllocatorService } from '@services/compliance/services/uhid-allocator.service';
import { VisitVitalsExaminationService } from '@services/patient-visits/services/visit-vitals-examination.service';

/**
 * Free-text clinical fields stored encrypted (AES-256-GCM) once FIELD_ENCRYPTION_KEY is set.
 * Selectable values (`nidra`, `habits`, flags) and identifiers stay plain so they remain queryable.
 * Every value is bound to its visit and column, see DatabaseService.encryptPhiField.
 */
const ENCRYPTED_VISIT_TEXT_FIELDS = [
  'presentIllness',
  'presentComplaints',
  'knownCaseOf',
  'pastHistoryNotes',
  'nidraNotes',
  'foodAllergyNotes',
  'drugAllergyNotes',
] as const;
type EncryptedVisitTextField = (typeof ENCRYPTED_VISIT_TEXT_FIELDS)[number];

/** Shown in place of a stored field that cannot be decrypted, so one bad row cannot hide a whole list. */
export const UNREADABLE_FIELD_MARKER = '[protected field could not be read]';

const visitFieldAad = (field: string, visitId: string): string =>
  `patient_visits.${field}:${visitId}`;

export interface VisitActor {
  userId?: string;
  role?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Consultation invoice as returned by BillingService, trimmed to the fields
 * this module needs. Resolved lazily via ModuleRef (see `getBillingService`)
 * instead of a constructor import, since PatientVisitsModule does not (and
 * per the task brief should not) import BillingModule.
 */
interface VisitInvoiceRecord {
  id: string;
  invoiceNumber: string;
  totalAmount: number;
  status: string;
  payments?: Array<{ amount: number; status: string }>;
}

interface BillingServiceLike {
  ensureVisitConsultationInvoice: (
    visitId: string,
    clinicId: string,
    options: {
      amount?: number;
      discount?: number;
      waive?: boolean;
      actor?: { userId?: string; role?: string };
    }
  ) => Promise<VisitInvoiceRecord>;
  recordInvoicePayment: (
    invoiceId: string,
    clinicId: string,
    options: {
      method: 'CASH' | 'UPI' | 'CARD' | 'NET_BANKING';
      amount?: number;
      transactionId?: string;
      note?: string;
      actor?: { userId?: string; role?: string };
    }
  ) => Promise<{ invoice: VisitInvoiceRecord; payment: { id: string } }>;
}

interface PatientVisitRow {
  id: string;
  opdNumber: string;
  registrationDate: Date;
  patientId: string;
  clinicId: string;
  doctorId: string | null;
  appointmentId: string | null;
  specialCaseFlags: string[];
  internationalId: string | null;
  presentIllness: string | null;
  presentComplaints: string | null;
  knownCaseOf: string | null;
  pastHistoryNotes: string | null;
  habits: Record<string, string> | null;
  nidra: string | null;
  nidraNotes: string | null;
  foodAllergyNotes: string | null;
  drugAllergyNotes: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VisitPatientSummary {
  id: string;
  userId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  age: number | null;
  address: string | null;
  area: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  occupation: string | null;
  organization: string | null;
}

export interface VisitCaseSheetResponse {
  visit: PatientVisitResponse;
  patient: VisitPatientSummary | null;
  vitalsExamination: VisitVitalsExaminationResponse | null;
  classicalExams: ClassicalExamFindingResponse[];
  familyHistory: Record<string, unknown>[];
  medications: Record<string, unknown>[];
  medicalHistory: Record<string, unknown>[];
  labReports: Record<string, unknown>[];
}

type VisitClient = PrismaTransactionClientWithDelegates & {
  patientVisit: {
    create: (args: PrismaDelegateArgs) => Promise<PatientVisitRow>;
    findFirst: (args: PrismaDelegateArgs) => Promise<PatientVisitRow | null>;
    findMany: (args: PrismaDelegateArgs) => Promise<PatientVisitRow[]>;
    update: (args: PrismaDelegateArgs) => Promise<PatientVisitRow>;
    count: (args: PrismaDelegateArgs) => Promise<number>;
  };
  familyHistory: { findMany: (args: PrismaDelegateArgs) => Promise<Record<string, unknown>[]> };
  medicalHistory: { findMany: (args: PrismaDelegateArgs) => Promise<Record<string, unknown>[]> };
  medication: { findMany: (args: PrismaDelegateArgs) => Promise<Record<string, unknown>[]> };
  labReport: { findMany: (args: PrismaDelegateArgs) => Promise<Record<string, unknown>[]> };
};

interface PatientWithUserRow {
  id: string;
  userId: string;
  user?: {
    id: string;
    name: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    email: string | null;
    gender: string | null;
    dateOfBirth: Date | null;
    age: number | null;
    address: string | null;
    area: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
    occupation: string | null;
    organization: string | null;
  } | null;
}

@Injectable()
export class PatientVisitsService {
  private billingServiceRef: BillingServiceLike | null = null;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly vitalsService: VisitVitalsExaminationService,
    private readonly classicalExamService: ClassicalExamService,
    private readonly moduleRef: ModuleRef,
    private readonly phiAudit: PhiAuditService,
    private readonly uhidAllocator: UhidAllocatorService
  ) {}

  private getBillingService(): BillingServiceLike | null {
    if (!this.billingServiceRef) {
      this.billingServiceRef = this.moduleRef.get<BillingServiceLike>('BILLING_SERVICE', {
        strict: false,
      });
    }
    return this.billingServiceRef;
  }

  async createVisit(
    dto: CreatePatientVisitDto,
    clinicId: string,
    actor: VisitActor
  ): Promise<PatientVisitResponse> {
    if (!dto.patientId && !dto.patientUserId && !dto.appointmentId) {
      throw new BadRequestException('patientId, patientUserId or appointmentId is required');
    }

    // A visit that belongs to an appointment: one per appointment, so asking again returns the
    // existing one, and the appointment decides the patient and the default doctor.
    const linked = dto.appointmentId
      ? await this.resolveAppointmentLink(dto.appointmentId, clinicId, dto)
      : null;
    if (linked?.existing) {
      return this.toResponse(linked.existing);
    }
    const effectiveDto: CreatePatientVisitDto = linked
      ? {
          ...dto,
          patientId: linked.patientId,
          ...(dto.doctorId || !linked.doctorId ? {} : { doctorId: linked.doctorId }),
        }
      : dto;

    const patient = await this.databaseService.executeHealthcareRead<{ id: string } | null>(
      async client => {
        const tc = client as unknown as PrismaTransactionClientWithDelegates;
        const row = effectiveDto.patientId
          ? await tc.patient.findUnique({
              where: { id: effectiveDto.patientId } as PrismaDelegateArgs,
              select: { id: true } as PrismaDelegateArgs,
            } as PrismaDelegateArgs)
          : await tc.patient.findFirst({
              where: { userId: effectiveDto.patientUserId } as PrismaDelegateArgs,
              select: { id: true } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
        return row ? { id: row.id } : null;
      }
    );
    if (!patient) {
      throw new NotFoundException(
        `Patient ${effectiveDto.patientId ?? effectiveDto.patientUserId} not found`
      );
    }
    const patientId = patient.id;
    await this.ensureUhidBestEffort(patientId, clinicId);

    const doctorId = effectiveDto.doctorId ?? (await this.resolveActorDoctorId(actor));
    const clinicCode = await this.resolveClinicCode(clinicId);

    let row: PatientVisitRow;
    try {
      row = await this.databaseService.executeHealthcareWrite<PatientVisitRow>(
        async client => {
          const tc = client as unknown as VisitClient;
          const opdNumber = await this.allocateOpdNumber(tc, clinicId, clinicCode);
          // The id is chosen here so encrypted fields can be bound to it before the insert.
          const visitId = randomUUID();
          return tc.patientVisit.create({
            data: {
              id: visitId,
              opdNumber,
              patientId,
              clinicId,
              doctorId: doctorId ?? null,
              appointmentId: dto.appointmentId ?? null,
              registrationDate: effectiveDto.registrationDate
                ? new Date(effectiveDto.registrationDate)
                : new Date(),
              specialCaseFlags: effectiveDto.specialCaseFlags ?? [],
              internationalId: this.cleanText(effectiveDto.internationalId),
              presentIllness: this.sealText('presentIllness', effectiveDto.presentIllness, visitId),
              presentComplaints: this.sealText(
                'presentComplaints',
                effectiveDto.presentComplaints,
                visitId
              ),
              knownCaseOf: this.sealText('knownCaseOf', effectiveDto.knownCaseOf, visitId),
              createdBy: actor.userId ?? null,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId: actor.userId || 'system',
          clinicId,
          resourceType: 'PATIENT_VISIT',
          operation: 'CREATE',
          resourceId: patientId,
          userRole: actor.role || 'system',
          details: { patientId },
        }
      );
    } catch (error) {
      // Two requests for the same appointment can race on the unique appointment link: the loser
      // returns the visit the winner created instead of failing.
      const existing = dto.appointmentId
        ? await this.findVisitByAppointment(dto.appointmentId, clinicId)
        : null;
      if (existing) {
        return this.toResponse(existing);
      }
      throw error;
    }

    await this.eventService.emit('patient-visit.created', {
      visitId: row.id,
      opdNumber: row.opdNumber,
      patientId: row.patientId,
      clinicId,
    });
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Patient visit registered',
      'PatientVisitsService',
      { visitId: row.id, opdNumber: row.opdNumber, clinicId }
    );

    const consultationInvoice = await this.attachConsultationInvoice(row, dto, clinicId, actor);
    return this.toResponse(row, consultationInvoice);
  }

  /**
   * Creates the visit of an appointment as a draft when the consultation starts, so notes can be
   * written during the call. Idempotent (one visit per appointment). No consultation invoice: the
   * visit is paid for by the booking or the subscription.
   */
  async ensureDraftVisitForAppointment(
    appointmentId: string,
    clinicId: string,
    actor: VisitActor = { role: 'system' }
  ): Promise<PatientVisitResponse> {
    return this.createVisit({ appointmentId, skipConsultationInvoice: true }, clinicId, actor);
  }

  private async findVisitByAppointment(
    appointmentId: string,
    clinicId: string
  ): Promise<PatientVisitRow | null> {
    return await this.databaseService.executeHealthcareRead<PatientVisitRow | null>(
      async client => {
        const tc = client as unknown as VisitClient;
        return await tc.patientVisit.findFirst({
          where: { appointmentId, clinicId } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      }
    );
  }

  /** Loads the appointment a visit is being linked to and checks it belongs to this clinic/patient. */
  private async resolveAppointmentLink(
    appointmentId: string,
    clinicId: string,
    dto: CreatePatientVisitDto
  ): Promise<{
    existing: PatientVisitRow | null;
    patientId: string;
    doctorId: string | null;
  }> {
    const appointment = await this.databaseService.executeHealthcareRead<{
      id: string;
      clinicId: string;
      patientId: string;
      doctorId: string | null;
    } | null>(async client => {
      const tc = client as unknown as PrismaTransactionClientWithDelegates;
      return (await tc.appointment.findUnique({
        where: { id: appointmentId } as PrismaDelegateArgs,
        select: { id: true, clinicId: true, patientId: true, doctorId: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as {
        id: string;
        clinicId: string;
        patientId: string;
        doctorId: string | null;
      } | null;
    });
    if (!appointment || appointment.clinicId !== clinicId) {
      throw new NotFoundException('Appointment not found in this clinic');
    }
    if (dto.patientId && dto.patientId !== appointment.patientId) {
      throw new BadRequestException('The appointment belongs to a different patient');
    }
    return {
      existing: await this.findVisitByAppointment(appointmentId, clinicId),
      patientId: appointment.patientId,
      doctorId: appointment.doctorId ?? null,
    };
  }

  /**
   * Best-effort: creates the OPD consultation invoice (and optionally
   * collects the fee immediately) for a just-registered visit. Never lets a
   * billing failure fail the registration itself — the visit row already
   * exists and the OPD number is already allocated by the time this runs, so
   * the worst case is a receptionist creating the bill manually afterwards
   * via `POST visits/:visitId/consultation-invoice`.
   */
  private async attachConsultationInvoice(
    row: PatientVisitRow,
    dto: CreatePatientVisitDto,
    clinicId: string,
    actor: VisitActor
  ): Promise<PatientVisitResponse['consultationInvoice']> {
    if (dto.skipConsultationInvoice) {
      return null;
    }

    const billingService = this.getBillingService();
    if (!billingService) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'BILLING_SERVICE unavailable; skipping consultation invoice for visit',
        'PatientVisitsService',
        { visitId: row.id }
      );
      return null;
    }

    const billingActor = {
      ...(actor.userId ? { userId: actor.userId } : {}),
      ...(actor.role ? { role: actor.role } : {}),
    };

    try {
      let invoice = await billingService.ensureVisitConsultationInvoice(row.id, clinicId, {
        ...(dto.consultationFee !== undefined ? { amount: dto.consultationFee } : {}),
        ...(dto.feeDiscount !== undefined ? { discount: dto.feeDiscount } : {}),
        ...(dto.waiveFee !== undefined ? { waive: dto.waiveFee } : {}),
        actor: billingActor,
      });

      if (dto.collectFee) {
        const result = await billingService.recordInvoicePayment(invoice.id, clinicId, {
          method: dto.collectFee.method,
          ...(dto.collectFee.transactionId ? { transactionId: dto.collectFee.transactionId } : {}),
          ...(dto.collectFee.note ? { note: dto.collectFee.note } : {}),
          actor: billingActor,
        });
        invoice = result.invoice;
      }

      const paidAmount =
        String(invoice.status).toUpperCase() === 'PAID'
          ? invoice.totalAmount
          : (invoice.payments || [])
              .filter(payment => String(payment.status).toUpperCase() === 'COMPLETED')
              .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        totalAmount: invoice.totalAmount,
        status: invoice.status,
        paidAmount,
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to create/collect consultation invoice for visit — registration was not affected',
        'PatientVisitsService',
        {
          visitId: row.id,
          clinicId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return null;
    }
  }

  async getVisitById(
    visitId: string,
    clinicId: string,
    actor?: VisitActor
  ): Promise<PatientVisitResponse> {
    const row = await this.findVisitRow(visitId, clinicId);
    await this.auditRead(actor, row, 'PATIENT_VISIT', ['visit']);
    return this.toResponse(row);
  }

  /**
   * Records that `actor` read a part of a visit (vitals, exam findings, ...) served by another
   * service. Called by the controller for those reads; a no-op without an authenticated actor.
   */
  async auditVisitRead(
    visitId: string,
    clinicId: string,
    actor: VisitActor | undefined,
    resourceType: string,
    fields: readonly string[]
  ): Promise<void> {
    if (!actor?.userId) return;
    const row = await this.findVisitRow(visitId, clinicId);
    await this.auditRead(actor, row, resourceType, fields);
  }

  async listVisitsForPatient(
    patientId: string,
    clinicId: string,
    options: { limit?: number; offset?: number } = {},
    actor?: VisitActor
  ): Promise<{ visits: PatientVisitResponse[]; total: number }> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);
    const where = { patientId, clinicId } as PrismaDelegateArgs;

    const result = await this.databaseService.executeHealthcareRead<{
      rows: PatientVisitRow[];
      total: number;
    }>(async client => {
      const tc = client as unknown as VisitClient;
      const rows = await tc.patientVisit.findMany({
        where,
        orderBy: { registrationDate: 'desc' } as PrismaDelegateArgs,
        take: limit,
        skip: offset,
      } as PrismaDelegateArgs);
      const total = await tc.patientVisit.count({ where } as PrismaDelegateArgs);
      return { rows, total };
    });

    if (actor?.userId) {
      await this.phiAudit.record({
        userId: actor.userId,
        userRole: actor.role ?? 'unknown',
        patientId,
        clinicId,
        action: 'VIEW',
        resourceType: 'PATIENT_VISIT_LIST',
        resourceId: patientId,
        fields: ['visit'],
        purpose: 'treatment',
        ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
        ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
      });
    }
    return { visits: result.rows.map(row => this.toResponse(row)), total: result.total };
  }

  async updateVisit(
    visitId: string,
    clinicId: string,
    dto: UpdatePatientVisitDto,
    actor: VisitActor
  ): Promise<PatientVisitResponse> {
    await this.findVisitRow(visitId, clinicId);

    const data: Record<string, unknown> = {};
    if (dto.doctorId !== undefined) data['doctorId'] = dto.doctorId || null;
    if (dto.specialCaseFlags !== undefined) data['specialCaseFlags'] = dto.specialCaseFlags;
    if (dto.habits !== undefined) data['habits'] = dto.habits;
    const textFields: Array<keyof UpdatePatientVisitDto> = [
      'internationalId',
      'presentIllness',
      'presentComplaints',
      'knownCaseOf',
      'pastHistoryNotes',
      'nidra',
      'nidraNotes',
      'foodAllergyNotes',
      'drugAllergyNotes',
    ];
    for (const field of textFields) {
      const value = dto[field];
      if (typeof value === 'string') {
        data[field] = this.isEncryptedTextField(field)
          ? this.sealText(field, value, visitId)
          : this.cleanText(value);
      }
    }

    const row = await this.databaseService.executeHealthcareWrite<PatientVisitRow>(
      async client => {
        const tc = client as unknown as VisitClient;
        return tc.patientVisit.update({
          where: { id: visitId } as PrismaDelegateArgs,
          data: data as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: actor.userId || 'system',
        clinicId,
        resourceType: 'PATIENT_VISIT',
        operation: 'UPDATE',
        resourceId: visitId,
        userRole: actor.role || 'system',
        details: { updateFields: Object.keys(data) },
      }
    );

    await this.eventService.emit('patient-visit.updated', { visitId, clinicId });
    return this.toResponse(row);
  }

  /**
   * Everything the case-sheet screen needs in one call. Deliberately not
   * cached: a case-sheet is edited continuously during a consultation, so a
   * cached copy would be stale within seconds of any save.
   */
  async getCaseSheet(
    visitId: string,
    clinicId: string,
    actor?: VisitActor
  ): Promise<VisitCaseSheetResponse> {
    const visitRow = await this.findVisitRow(visitId, clinicId);
    await this.auditRead(actor, visitRow, 'CASE_SHEET', [
      'visit',
      'vitals',
      'classicalExams',
      'familyHistory',
      'medications',
      'medicalHistory',
      'labReports',
    ]);
    const [vitalsExamination, classicalExams] = await Promise.all([
      this.vitalsService.getForVisit(visitId, clinicId),
      this.classicalExamService.getFindingsForVisit(visitId, clinicId),
    ]);

    const bundle = await this.databaseService.executeHealthcareRead<{
      patient: VisitPatientSummary | null;
      familyHistory: Record<string, unknown>[];
      medications: Record<string, unknown>[];
      medicalHistory: Record<string, unknown>[];
      labReports: Record<string, unknown>[];
    }>(async client => {
      const tc = client as unknown as VisitClient;
      const patientRow = (await tc.patient.findUnique({
        where: { id: visitRow.patientId } as PrismaDelegateArgs,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
              gender: true,
              dateOfBirth: true,
              age: true,
              address: true,
              area: true,
              district: true,
              city: true,
              state: true,
              occupation: true,
              organization: true,
            },
          },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as unknown as PatientWithUserRow | null;

      const user = patientRow?.user;
      if (!patientRow || !user) {
        return {
          patient: null,
          familyHistory: [],
          medications: [],
          medicalHistory: [],
          labReports: [],
        };
      }

      const userId = patientRow.userId;
      const familyHistory = await tc.familyHistory.findMany({
        where: { userId } as PrismaDelegateArgs,
        orderBy: { createdAt: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
      const medications = await tc.medication.findMany({
        where: { userId, isActive: true } as PrismaDelegateArgs,
        orderBy: { startDate: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
      const medicalHistory = await tc.medicalHistory.findMany({
        where: { userId } as PrismaDelegateArgs,
        orderBy: { date: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
      const labReports = await tc.labReport.findMany({
        where: { userId } as PrismaDelegateArgs,
        orderBy: { date: 'desc' } as PrismaDelegateArgs,
        take: 20,
      } as PrismaDelegateArgs);

      return {
        patient: {
          id: patientRow.id,
          userId,
          name: user.name,
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          phone: user.phone ?? null,
          email: user.email ?? null,
          gender: user.gender ?? null,
          dateOfBirth: user.dateOfBirth ? new Date(user.dateOfBirth).toISOString() : null,
          age: user.age ?? null,
          address: user.address ?? null,
          area: user.area ?? null,
          district: user.district ?? null,
          city: user.city ?? null,
          state: user.state ?? null,
          occupation: user.occupation ?? null,
          organization: user.organization ?? null,
        },
        familyHistory: familyHistory.map(row => this.serializeDates(row)),
        medications: medications.map(row => this.serializeDates(row)),
        medicalHistory: medicalHistory.map(row => this.serializeDates(row)),
        labReports: labReports.map(row => this.serializeDates(row)),
      };
    });

    return {
      visit: this.toResponse(visitRow),
      patient: bundle.patient,
      vitalsExamination,
      classicalExams,
      familyHistory: bundle.familyHistory,
      medications: bundle.medications,
      medicalHistory: bundle.medicalHistory,
      labReports: bundle.labReports,
    };
  }

  private async findVisitRow(visitId: string, clinicId: string): Promise<PatientVisitRow> {
    const row = await this.databaseService.executeHealthcareRead<PatientVisitRow | null>(
      async client => {
        const tc = client as unknown as VisitClient;
        return tc.patientVisit.findFirst({
          where: { id: visitId, clinicId } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      }
    );
    if (!row) {
      throw new NotFoundException(`Visit ${visitId} not found`);
    }
    return row;
  }

  private async resolveActorDoctorId(actor: VisitActor): Promise<string | undefined> {
    if (!actor.userId) return undefined;
    const role = String(actor.role || '').toUpperCase();
    const doctorRoles: readonly string[] = [Role.DOCTOR, Role.ASSISTANT_DOCTOR];
    if (!doctorRoles.includes(role)) return undefined;

    const doctor = await this.databaseService.executeHealthcareRead<{ id: string } | null>(
      async client => {
        const tc = client as unknown as PrismaTransactionClientWithDelegates;
        const row = await tc.doctor.findUnique({
          where: { userId: actor.userId } as PrismaDelegateArgs,
          select: { id: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        return row ? { id: row.id } : null;
      }
    );
    return doctor?.id;
  }

  private async resolveClinicCode(clinicId: string): Promise<string> {
    const clinic = await this.databaseService.executeHealthcareRead<{
      clinicId?: string | null;
    } | null>(async client => {
      const tc = client as unknown as PrismaTransactionClientWithDelegates;
      return (await tc.clinic.findUnique({
        where: { id: clinicId } as PrismaDelegateArgs,
        select: { clinicId: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as unknown as { clinicId?: string | null } | null;
    });
    const code = clinic?.clinicId?.trim();
    return code && code.length > 0 ? code.toUpperCase() : clinicId.slice(0, 8).toUpperCase();
  }

  /**
   * Allocates the next OPD number for a clinic with one atomic statement.
   *
   * executeHealthcareWrite does not run its callback inside a single
   * transaction, so a transaction-scoped advisory lock (the invoice-number
   * approach in BillingService) does not serialize concurrent callers — a
   * 12-way concurrent registration test produced unique-constraint
   * violations. A row-level upsert-increment on `opd_sequences` is atomic by
   * itself: the first caller for a clinic seeds the counter from existing
   * visits, every later caller increments under the row lock.
   */
  private async allocateOpdNumber(
    tc: VisitClient,
    clinicId: string,
    clinicCode: string
  ): Promise<string> {
    const rows = await tc.$queryRaw<Array<{ lastValue: number | string }>>`
      INSERT INTO "opd_sequences" ("clinicId", "lastValue", "updatedAt")
      VALUES (
        ${clinicId},
        (
          SELECT COALESCE(MAX(CAST(SUBSTRING("opdNumber" FROM '([0-9]+)$') AS INTEGER)), 0) + 1
          FROM "patient_visits"
          WHERE "clinicId" = ${clinicId} AND "opdNumber" ~ '^OPD-'
        ),
        NOW()
      )
      ON CONFLICT ("clinicId")
      DO UPDATE SET "lastValue" = "opd_sequences"."lastValue" + 1, "updatedAt" = NOW()
      RETURNING "lastValue"
    `;

    const nextSequence = Number(rows?.[0]?.lastValue ?? 0);
    if (!Number.isFinite(nextSequence) || nextSequence <= 0) {
      throw new BadRequestException('Could not allocate an OPD number');
    }
    const year = new Date().getFullYear();
    return `OPD-${clinicCode}-${year}-${nextSequence.toString().padStart(6, '0')}`;
  }

  private isEncryptedTextField(field: string): field is EncryptedVisitTextField {
    return (ENCRYPTED_VISIT_TEXT_FIELDS as readonly string[]).includes(field);
  }

  /** Trim, then encrypt for storage (plaintext while no encryption key is configured). */
  private sealText(
    field: EncryptedVisitTextField,
    value: string | undefined,
    visitId: string
  ): string | null {
    return this.databaseService.encryptPhiField(
      this.cleanText(value),
      visitFieldAad(field, visitId)
    );
  }

  /** Read a stored text field: decrypts, and passes legacy plaintext rows through. */
  private openText(
    field: EncryptedVisitTextField,
    stored: string | null | undefined,
    visitId: string
  ): string | null {
    try {
      return this.databaseService.decryptPhiField(stored, visitFieldAad(field, visitId));
    } catch (error) {
      // FieldEncryptionService has already logged the reason at ERROR level. Degrade this one
      // field instead of failing the visit list, the case sheet and every FHIR read with it.
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'A protected visit field could not be read',
        'PatientVisitsService',
        { visitId, field, error: error instanceof Error ? error.message : String(error) }
      );
      return UNREADABLE_FIELD_MARKER;
    }
  }

  private async auditRead(
    actor: VisitActor | undefined,
    row: PatientVisitRow,
    resourceType: string,
    fields: readonly string[]
  ): Promise<void> {
    if (!actor?.userId) return;
    await this.phiAudit.record({
      userId: actor.userId,
      userRole: actor.role ?? 'unknown',
      patientId: row.patientId,
      clinicId: row.clinicId,
      action: 'VIEW',
      resourceType,
      resourceId: row.id,
      fields,
      purpose: 'treatment',
      ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
      ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
    });
  }

  /**
   * Every patient gets a UHID at their first registration in a clinic. Registration must not fail
   * because of it (it can be issued afterwards from the identifiers endpoint), so a failure is
   * logged and the visit proceeds.
   */
  private async ensureUhidBestEffort(patientId: string, clinicId: string): Promise<void> {
    try {
      await this.uhidAllocator.ensureUhid(patientId, clinicId);
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        'Could not issue a UHID during visit registration',
        'PatientVisitsService',
        { patientId, clinicId, error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  private cleanText(value: string | undefined): string | null {
    if (value === undefined) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private serializeDates(row: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value instanceof Date ? value.toISOString() : value,
      ])
    );
  }

  private toResponse(
    row: PatientVisitRow,
    consultationInvoice?: PatientVisitResponse['consultationInvoice']
  ): PatientVisitResponse {
    return {
      id: row.id,
      opdNumber: row.opdNumber,
      registrationDate: new Date(row.registrationDate).toISOString(),
      patientId: row.patientId,
      clinicId: row.clinicId,
      doctorId: row.doctorId ?? null,
      appointmentId: row.appointmentId ?? null,
      specialCaseFlags: (row.specialCaseFlags ?? []) as SpecialCaseFlag[],
      internationalId: row.internationalId ?? null,
      presentIllness: this.openText('presentIllness', row.presentIllness, row.id),
      presentComplaints: this.openText('presentComplaints', row.presentComplaints, row.id),
      knownCaseOf: this.openText('knownCaseOf', row.knownCaseOf, row.id),
      pastHistoryNotes: this.openText('pastHistoryNotes', row.pastHistoryNotes, row.id),
      habits: row.habits ?? null,
      nidra: row.nidra ?? null,
      nidraNotes: this.openText('nidraNotes', row.nidraNotes, row.id),
      foodAllergyNotes: this.openText('foodAllergyNotes', row.foodAllergyNotes, row.id),
      drugAllergyNotes: this.openText('drugAllergyNotes', row.drugAllergyNotes, row.id),
      createdBy: row.createdBy ?? null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      ...(consultationInvoice !== undefined ? { consultationInvoice } : {}),
    };
  }
}
