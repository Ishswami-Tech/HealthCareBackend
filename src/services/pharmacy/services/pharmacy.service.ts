import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { EventService } from '@infrastructure/events/event.service';
import { LoggingService } from '@infrastructure/logging';
import {
  CreateMedicineDto,
  UpdateInventoryDto,
  CreatePrescriptionDto,
  DispensePrescriptionDto,
  PrescriptionStatus,
  CreateSupplierDto,
  UpdateSupplierDto,
} from '@dtos/pharmacy.dto';
import { LogLevel, LogType } from '@core/types';
import { PrismaDelegateArgs, PrismaTransactionClientWithDelegates } from '@core/types/prisma.types';
import { PaymentStatus } from '@core/types/enums.types';
import { PaymentService } from '@payment/payment.service';
import type { PaymentIntentOptions, PaymentResult } from '@core/types/payment.types';
import { PaymentProvider } from '@core/types/payment.types';
import { AppointmentQueueService } from '@infrastructure/queue';

type PrescriptionDispenseItem = {
  id?: string;
  prescriptionItemId?: string | null;
  medicineId?: string | null;
  quantity?: number | null;
  dispensedQuantity?: number | null;
  dispensedAt?: Date | string | null;
  dispensedBatchNumber?: string | null;
  dispensedBatchExpiryDate?: Date | string | null;
  dispenseBatchHistory?: PrescriptionDispenseBatchHistoryEntry[] | null;
  dispenseEventHistory?: PrescriptionDispenseBatchHistoryEntry[] | null;
  medicine?: {
    price?: number | null;
    name?: string | null;
    stock?: number | null;
  } | null;
};

type PrescriptionDispenseBatchHistoryEntry = {
  quantity: number;
  batchNumber?: string | null;
  expiryDate?: string | null;
  dispensedAt: string;
  medicineId?: string | null;
  originalMedicineId?: string | null;
  substituteMedicineId?: string | null;
  eventType?: 'DISPENSE' | 'SUBSTITUTION' | 'REVERSAL';
  reason?: string | null;
  reversedAt?: string | null;
  reversalReason?: string | null;
};

type PrescriptionDispenseRequestItem = {
  medicineId: string;
  prescriptionItemId?: string;
  substituteMedicineId?: string;
  substitutionReason?: string;
  quantity: number;
  lots: Array<{
    quantity: number;
    batchNumber?: string;
    expiryDate?: string;
  }>;
};

type PharmacyBatchAuditEntry = {
  prescriptionId: string;
  prescriptionItemId: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  medicineId: string;
  medicineName: string;
  originalMedicineId: string;
  originalMedicineName: string;
  substituteMedicineId?: string | null;
  substituteMedicineName?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
  quantity: number;
  eventType: 'DISPENSE' | 'SUBSTITUTION' | 'REVERSAL';
  eventAt: string;
  reason?: string | null;
  reversedAt?: string | null;
  reversalReason?: string | null;
};

type InventoryFilterOptions = {
  lowStock?: boolean;
  expiringSoon?: boolean;
  expiringDays?: number;
};

@Injectable()
export class PharmacyService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly paymentService: PaymentService,
    private readonly eventService: EventService,
    private readonly loggingService: LoggingService,
    private readonly appointmentQueueService: AppointmentQueueService
  ) {}

  private static readonly COMPLETED_PAYMENT_STATUS = 'COMPLETED';
  private static readonly PAYMENT_FOR_PRESCRIPTION_DISPENSE = 'PRESCRIPTION_DISPENSE';
  private static readonly MEDICINE_QUEUE_DOMAIN = 'medicine-desk';

  private isSupportedPaymentProvider(provider: string): provider is PaymentProvider {
    return (
      provider === 'cashfree' ||
      provider === 'payu' ||
      provider === 'phonepe' ||
      provider === 'razorpay' ||
      provider === 'stripe'
    );
  }

  private getMetadataStringValue(metadata: unknown, key: string): string | undefined {
    const metadataRecord = this.asRecord(metadata);
    const rawValue = metadataRecord?.[key];

    if (typeof rawValue === 'string') {
      return rawValue;
    }

    if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
      return String(rawValue);
    }

    return undefined;
  }

  private getPrescriptionPaymentMetadata(prescriptionId: string): Record<string, string> {
    return {
      prescriptionId,
      paymentFor: PharmacyService.PAYMENT_FOR_PRESCRIPTION_DISPENSE,
      queueCategory: 'MEDICINE_DESK',
    };
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private normalizePaymentProvider(provider?: string): PaymentProvider | undefined {
    if (!provider) {
      return undefined;
    }

    const normalized = provider.toLowerCase();
    return this.isSupportedPaymentProvider(normalized) ? normalized : undefined;
  }

  private getPrescriptionTotal(prescription: { items?: PrescriptionDispenseItem[] }): number {
    return Number(
      (prescription.items || [])
        .reduce((sum, item) => {
          const quantity = Number(item.quantity || 0);
          const unitPrice = Number(item.medicine?.price || 0);
          return sum + quantity * unitPrice;
        }, 0)
        .toFixed(2)
    );
  }

  private getPrescriptionPayments(
    payments: Array<{
      amount?: number | null;
      status?: PaymentStatus | string | null;
      metadata?: unknown;
    }>,
    prescriptionId: string
  ) {
    return payments.filter(payment => {
      return (
        this.getMetadataStringValue(payment.metadata, 'paymentFor') ===
          PharmacyService.PAYMENT_FOR_PRESCRIPTION_DISPENSE &&
        this.getMetadataStringValue(payment.metadata, 'prescriptionId') === prescriptionId
      );
    });
  }

  private buildPrescriptionPaymentState(
    prescription: {
      id: string;
      date?: Date | string | null;
      items?: PrescriptionDispenseItem[];
    },
    payments: Array<{
      id: string;
      amount?: number | null;
      status?: PaymentStatus | string | null;
      metadata?: unknown;
      createdAt?: Date | null;
    }>
  ) {
    const totalAmount = this.getPrescriptionTotal(prescription);
    const linkedPayments = this.getPrescriptionPayments(payments, prescription.id);
    const paidAmount = Number(
      linkedPayments
        .filter(payment => String(payment.status) === PharmacyService.COMPLETED_PAYMENT_STATUS)
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
        .toFixed(2)
    );
    const pendingAmount = Math.max(0, Number((totalAmount - paidAmount).toFixed(2)));

    let paymentStatus: 'PENDING' | 'PARTIAL' | 'PAID' = 'PENDING';
    if (pendingAmount <= 0 && totalAmount > 0) {
      paymentStatus = 'PAID';
    } else if (paidAmount > 0 && pendingAmount > 0) {
      paymentStatus = 'PARTIAL';
    }

    return {
      totalAmount,
      paidAmount,
      pendingAmount,
      paymentStatus,
      canDispense: totalAmount <= 0 || pendingAmount <= 0,
      payments: linkedPayments,
    };
  }

  private getPrescriptionItemRemainingQuantity(item: PrescriptionDispenseItem): number {
    return Math.max(0, Number(item.quantity || 0) - Number(item.dispensedQuantity || 0));
  }

  private getPrescriptionDispenseStatus(items: PrescriptionDispenseItem[]): PrescriptionStatus {
    return items.every(item => this.getPrescriptionItemRemainingQuantity(item) <= 0)
      ? PrescriptionStatus.FILLED
      : PrescriptionStatus.PARTIAL;
  }

  private normalizeDispenseRequestItems(
    items?: DispensePrescriptionDto['items']
  ): PrescriptionDispenseRequestItem[] {
    if (!items || items.length === 0) {
      return [];
    }

    const aggregated = new Map<string, PrescriptionDispenseRequestItem>();

    for (const item of items) {
      const requestKey = String(item.prescriptionItemId || item.medicineId);
      const current: PrescriptionDispenseRequestItem = aggregated.get(requestKey) || {
        medicineId: item.medicineId,
        ...(item.prescriptionItemId ? { prescriptionItemId: item.prescriptionItemId } : {}),
        quantity: 0,
        lots: [],
      };

      const lotQuantity = Number(item.quantity || 0);
      current.quantity += lotQuantity;
      current.lots.push({
        quantity: lotQuantity,
        ...(item.batchNumber ? { batchNumber: item.batchNumber } : {}),
        ...(item.expiryDate ? { expiryDate: item.expiryDate } : {}),
      });

      aggregated.set(requestKey, current);
    }

    return Array.from(aggregated.values());
  }

  private buildFullDispenseRequestItems(
    prescriptionItems: PrescriptionDispenseItem[]
  ): PrescriptionDispenseRequestItem[] {
    return prescriptionItems
      .filter(item => this.getPrescriptionItemRemainingQuantity(item) > 0 && item.medicineId)
      .map(item => ({
        medicineId: String(item.medicineId),
        quantity: this.getPrescriptionItemRemainingQuantity(item),
        ...(item.id ? { prescriptionItemId: String(item.id) } : {}),
        lots: [
          {
            quantity: this.getPrescriptionItemRemainingQuantity(item),
          },
        ],
      }));
  }

  private normalizeStoredDispenseBatchHistory(
    history: PrescriptionDispenseItem['dispenseBatchHistory']
  ): PrescriptionDispenseBatchHistoryEntry[] {
    if (!Array.isArray(history)) {
      return [];
    }

    return history
      .map((entry): PrescriptionDispenseBatchHistoryEntry | null => {
        const quantity = Number(entry?.quantity || 0);
        if (quantity <= 0) {
          return null;
        }

        return {
          quantity,
          ...(entry?.batchNumber ? { batchNumber: entry.batchNumber } : {}),
          ...(entry?.expiryDate ? { expiryDate: entry.expiryDate } : {}),
          dispensedAt: String(entry?.dispensedAt || new Date().toISOString()),
        } as PrescriptionDispenseBatchHistoryEntry;
      })
      .filter((entry): entry is PrescriptionDispenseBatchHistoryEntry => Boolean(entry));
  }

  private normalizeStoredDispenseEventHistory(
    history: PrescriptionDispenseItem['dispenseEventHistory']
  ): PrescriptionDispenseBatchHistoryEntry[] {
    if (!Array.isArray(history)) {
      return [];
    }

    return history
      .map((entry): PrescriptionDispenseBatchHistoryEntry | null => {
        const quantity = Number(entry?.quantity || 0);
        if (quantity <= 0) {
          return null;
        }

        return {
          quantity,
          ...(entry?.batchNumber ? { batchNumber: entry.batchNumber } : {}),
          ...(entry?.expiryDate ? { expiryDate: entry.expiryDate } : {}),
          ...(entry?.medicineId ? { medicineId: entry.medicineId } : {}),
          ...(entry?.originalMedicineId ? { originalMedicineId: entry.originalMedicineId } : {}),
          ...(entry?.substituteMedicineId
            ? { substituteMedicineId: entry.substituteMedicineId }
            : {}),
          eventType:
            entry?.eventType === 'REVERSAL'
              ? 'REVERSAL'
              : entry?.eventType === 'SUBSTITUTION'
                ? 'SUBSTITUTION'
                : 'DISPENSE',
          dispensedAt: String(entry?.dispensedAt || new Date().toISOString()),
          ...(entry?.reason ? { reason: entry.reason } : {}),
          ...(entry?.reversedAt ? { reversedAt: String(entry.reversedAt) } : {}),
          ...(entry?.reversalReason ? { reversalReason: entry.reversalReason } : {}),
        } as PrescriptionDispenseBatchHistoryEntry;
      })
      .filter((entry): entry is PrescriptionDispenseBatchHistoryEntry => Boolean(entry));
  }

  private buildDispenseEventHistoryEntry(args: {
    quantity: number;
    medicineId: string;
    originalMedicineId: string;
    substituteMedicineId?: string | null;
    batchNumber?: string | null;
    expiryDate?: string | null;
    eventType?: 'DISPENSE' | 'SUBSTITUTION' | 'REVERSAL';
    reason?: string | null;
    dispensedAt?: Date;
    reversedAt?: Date | null;
    reversalReason?: string | null;
  }): PrescriptionDispenseBatchHistoryEntry {
    return {
      quantity: Number(args.quantity || 0),
      medicineId: args.medicineId,
      originalMedicineId: args.originalMedicineId,
      ...(args.substituteMedicineId ? { substituteMedicineId: args.substituteMedicineId } : {}),
      ...(args.batchNumber ? { batchNumber: args.batchNumber } : {}),
      ...(args.expiryDate ? { expiryDate: args.expiryDate } : {}),
      eventType: args.eventType || 'DISPENSE',
      dispensedAt: String(args.dispensedAt?.toISOString() || new Date().toISOString()),
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.reversedAt ? { reversedAt: args.reversedAt.toISOString() } : {}),
      ...(args.reversalReason ? { reversalReason: args.reversalReason } : {}),
    };
  }

  private appendDispenseHistory(
    existingHistory: PrescriptionDispenseItem['dispenseBatchHistory'],
    entries: PrescriptionDispenseBatchHistoryEntry[]
  ): PrescriptionDispenseBatchHistoryEntry[] {
    return [...this.normalizeStoredDispenseBatchHistory(existingHistory), ...entries];
  }

  private appendDispenseEventHistory(
    existingHistory: PrescriptionDispenseItem['dispenseEventHistory'],
    entries: PrescriptionDispenseBatchHistoryEntry[]
  ): PrescriptionDispenseBatchHistoryEntry[] {
    return [...this.normalizeStoredDispenseEventHistory(existingHistory), ...entries];
  }

  private async recordPharmacyAuditLog(args: {
    userId: string;
    action: string;
    description: string;
    clinicId?: string | null;
    resourceType?: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          auditLog: { create: (input: PrismaDelegateArgs) => Promise<unknown> };
        };

        await typedClient.auditLog.create({
          data: {
            userId: args.userId,
            action: args.action,
            description: args.description,
            clinicId: args.clinicId ?? null,
            resourceType: args.resourceType ?? 'PHARMACY',
            resourceId: args.resourceId ?? null,
            metadata: args.metadata ?? {},
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: args.userId,
        clinicId: args.clinicId ?? 'unknown',
        resourceType: args.resourceType ?? 'PHARMACY',
        operation: 'CREATE',
        resourceId: args.resourceId ?? '',
        userRole: 'system',
        details: {
          action: args.action,
          description: args.description,
          ...(args.metadata || {}),
        },
      }
    );
  }

  private getMedicineDeskQueueOwnerId(clinicId: string): string {
    return `medicine-desk:${clinicId}`;
  }

  private getMedicineDeskQueueLifecycleStatus(args: {
    prescriptionStatus?: PrescriptionStatus | string | null;
    paymentStatus: 'PENDING' | 'PARTIAL' | 'PAID';
    isActiveQueueEntry: boolean;
  }): 'WAITING_FOR_PAYMENT' | 'READY_FOR_HANDOVER' | 'DISPENSED' | 'CANCELLED' {
    const prescriptionStatus = String(args.prescriptionStatus || '').toUpperCase();

    if (prescriptionStatus === 'FILLED') {
      return 'DISPENSED';
    }

    if (prescriptionStatus === 'CANCELLED') {
      return 'CANCELLED';
    }

    if (!args.isActiveQueueEntry) {
      return args.paymentStatus === 'PAID' ? 'READY_FOR_HANDOVER' : 'WAITING_FOR_PAYMENT';
    }

    return args.paymentStatus === 'PAID' ? 'READY_FOR_HANDOVER' : 'WAITING_FOR_PAYMENT';
  }

  private toMedicineDeskQueueResponse<
    T extends {
      id: string;
      clinicId: string;
      patientId?: string;
      doctorId?: string;
      locationId?: string | null;
      status?: PrescriptionStatus | string | null;
      patient?: {
        user?: {
          id?: string | null;
          phone?: string | null;
          email?: string | null;
        } | null;
      } | null;
    },
  >(
    prescription: T,
    context: {
      paymentState: {
        totalAmount: number;
        paidAmount: number;
        pendingAmount: number;
        paymentStatus: 'PENDING' | 'PARTIAL' | 'PAID';
        canDispense: boolean;
      };
      queueOwnerId: string;
      queuePosition: number | null;
      totalInQueue: number;
      patientName: string;
      doctorName: string;
      medicineNames: string[];
      prescribedAt?: Date | string | null;
      locationName?: string | null;
      doctorRole?: string;
    }
  ) {
    const queuePosition =
      typeof context.queuePosition === 'number' && context.queuePosition > 0
        ? context.queuePosition
        : null;
    const isActiveQueueEntry = queuePosition !== null;
    const prescriptionStatus = String(prescription.status || '').toUpperCase();
    const lifecycleStatus = this.getMedicineDeskQueueLifecycleStatus({
      prescriptionStatus: prescription.status ?? null,
      paymentStatus: context.paymentState.paymentStatus,
      isActiveQueueEntry,
    });

    return {
      ...prescription,
      ...context.paymentState,
      entryId: prescription.id,
      queueCategory: 'MEDICINE_DESK',
      queueOwnerId: context.queueOwnerId,
      queueStatus:
        lifecycleStatus === 'DISPENSED'
          ? 'DISPENSED'
          : lifecycleStatus === 'CANCELLED'
            ? 'CANCELLED'
            : 'PENDING',
      status: prescriptionStatus === 'PARTIAL' ? 'PARTIAL' : lifecycleStatus,
      position: queuePosition,
      queuePosition,
      activeQueueEntry: isActiveQueueEntry,
      totalInQueue: context.totalInQueue,
      patientName: context.patientName,
      doctorName: context.doctorName,
      patientUserId: prescription.patient?.user?.id || null,
      patientPhone: prescription.patient?.user?.phone || null,
      patientEmail: prescription.patient?.user?.email || null,
      assignedDoctorId: prescription.doctorId || null,
      primaryDoctorId: prescription.doctorId || null,
      doctorRole: String(context.doctorRole || 'DOCTOR').toUpperCase(),
      locationId: prescription.locationId || null,
      locationName: context.locationName || null,
      prescribedAt: context.prescribedAt || null,
      medicineNames: context.medicineNames,
      itemsCount: context.medicineNames.length,
      waitingForPayment: lifecycleStatus === 'WAITING_FOR_PAYMENT',
      readyForHandover: lifecycleStatus === 'READY_FOR_HANDOVER',
    };
  }

  private async syncMedicineDeskQueueEntries<
    T extends {
      id: string;
      clinicId: string;
      patientId?: string;
      doctorId?: string;
      locationId?: string | null;
      status?: PrescriptionStatus | string | null;
      date?: Date | string | null;
    },
  >(prescriptions: T[]): Promise<void> {
    const groupedByClinic = prescriptions.reduce<Record<string, T[]>>(
      (accumulator, prescription) => {
        const clinicPrescriptions = accumulator[prescription.clinicId] || [];
        clinicPrescriptions.push(prescription);
        accumulator[prescription.clinicId] = clinicPrescriptions;
        return accumulator;
      },
      {}
    );

    for (const [clinicId, clinicPrescriptions] of Object.entries(groupedByClinic)) {
      clinicPrescriptions.sort((left, right) => {
        const leftTime = new Date(left.date || 0).getTime();
        const rightTime = new Date(right.date || 0).getTime();
        return leftTime - rightTime;
      });

      const queueOwnerId = this.getMedicineDeskQueueOwnerId(clinicId);
      const existingQueue = await this.appointmentQueueService.getOperationalQueue(
        queueOwnerId,
        clinicId,
        PharmacyService.MEDICINE_QUEUE_DOMAIN
      );
      const activePrescriptionIds = new Set(
        clinicPrescriptions
          .filter(
            prescription =>
              String(prescription.status || '').toUpperCase() !== 'FILLED' &&
              String(prescription.status || '').toUpperCase() !== 'CANCELLED'
          )
          .map(prescription => prescription.id)
      );

      for (const queueEntry of existingQueue) {
        if (queueEntry.entryId && !activePrescriptionIds.has(queueEntry.entryId)) {
          await this.appointmentQueueService.removeOperationalQueueItem(
            queueEntry.entryId,
            queueOwnerId,
            clinicId,
            PharmacyService.MEDICINE_QUEUE_DOMAIN
          );
        }
      }

      for (const prescription of clinicPrescriptions) {
        if (
          String(prescription.status || '').toUpperCase() === 'FILLED' ||
          String(prescription.status || '').toUpperCase() === 'CANCELLED'
        ) {
          continue;
        }

        await this.appointmentQueueService.enqueueOperationalItem(
          {
            entryId: prescription.id,
            appointmentId: prescription.id,
            queueOwnerId,
            patientId: prescription.patientId || '',
            clinicId,
            ...(prescription.doctorId ? { assignedDoctorId: prescription.doctorId } : {}),
            ...(prescription.doctorId ? { primaryDoctorId: prescription.doctorId } : {}),
            ...(prescription.locationId ? { locationId: prescription.locationId } : {}),
            queueCategory: 'MEDICINE_DESK',
            type: 'MEDICINE_DESK',
          },
          PharmacyService.MEDICINE_QUEUE_DOMAIN
        );
      }
    }
  }

  private async enrichPrescriptionsWithPaymentState<
    T extends {
      id: string;
      clinicId: string;
      patientId?: string;
      doctorId?: string;
      locationId?: string | null;
      date?: Date | string | null;
      status?: PrescriptionStatus | string | null;
      items?: PrescriptionDispenseItem[];
      patient?: {
        id?: string;
        name?: string | null;
        user?: {
          id?: string | null;
          name?: string | null;
          phone?: string | null;
          email?: string | null;
        } | null;
      } | null;
      doctor?: {
        id?: string;
        name?: string | null;
        user?: {
          id?: string | null;
          name?: string | null;
          role?: string | null;
        } | null;
      } | null;
      location?: {
        id?: string;
        name?: string | null;
      } | null;
    },
  >(prescriptions: T[], clinicId?: string) {
    if (prescriptions.length === 0) {
      return prescriptions;
    }

    const payments = clinicId ? await this.databaseService.findPaymentsSafe({ clinicId }) : [];
    await this.syncMedicineDeskQueueEntries(prescriptions);

    const queueByClinic = new Map<
      string,
      {
        positions: Map<string, number>;
        totalInQueue: number;
      }
    >();

    const clinicIds = Array.from(new Set(prescriptions.map(prescription => prescription.clinicId)));
    for (const currentClinicId of clinicIds) {
      const queueOwnerId = this.getMedicineDeskQueueOwnerId(currentClinicId);
      const queue = await this.appointmentQueueService.getOperationalQueue(
        queueOwnerId,
        currentClinicId,
        PharmacyService.MEDICINE_QUEUE_DOMAIN
      );

      queueByClinic.set(currentClinicId, {
        positions: new Map(
          queue
            .filter(queueEntry => queueEntry.entryId)
            .map(queueEntry => [String(queueEntry.entryId), Number(queueEntry.position || 0)])
        ),
        totalInQueue: queue.length,
      });
    }

    return prescriptions.map(prescription => {
      const paymentState = this.buildPrescriptionPaymentState(prescription, payments);
      const queueState = queueByClinic.get(prescription.clinicId);
      const queuePosition = Number(queueState?.positions.get(prescription.id) || 0);
      const totalInQueue = Number(queueState?.totalInQueue || 0);

      const patientName =
        prescription.patient?.user?.name || prescription.patient?.name || 'Unknown Patient';
      const doctorName =
        prescription.doctor?.user?.name || prescription.doctor?.name || 'Unknown Doctor';
      const medicineNames = (prescription.items || [])
        .map(item => item.medicine)
        .filter((medicine): medicine is { price?: number | null; name?: string | null } =>
          Boolean(medicine)
        )
        .map(medicine => medicine.name || 'Medicine');

      return this.toMedicineDeskQueueResponse(prescription, {
        paymentState,
        queueOwnerId: this.getMedicineDeskQueueOwnerId(prescription.clinicId),
        queuePosition: queuePosition > 0 ? queuePosition : null,
        totalInQueue,
        patientName,
        doctorName,
        medicineNames,
        prescribedAt: prescription.date || null,
        locationName: prescription.location?.name || null,
        doctorRole: String(prescription.doctor?.user?.role || 'DOCTOR').toUpperCase(),
      });
    });
  }

  private async emitMedicineDeskQueueUpdated(
    clinicId: string,
    prescriptionId: string,
    action: 'CREATED' | 'PAYMENT_UPDATED' | 'DISPENSED' | 'PARTIALLY_DISPENSED' | 'CANCELLED'
  ) {
    try {
      const queue = await this.getMedicineDeskQueue(clinicId);
      const activeEntry = queue.find(
        item => String((item as { id?: string }).id || '') === prescriptionId
      ) as
        | {
            position?: number | null;
            queuePosition?: number | null;
            status?: string;
            paymentStatus?: string;
            pendingAmount?: number;
            queueStatus?: string;
            totalInQueue?: number;
            readyForHandover?: boolean;
          }
        | undefined;

      await this.eventService.emit('pharmacy.medicine_desk.updated', {
        clinicId,
        prescriptionId,
        action,
        entryId: prescriptionId,
        queueCategory: 'MEDICINE_DESK',
        queueOwnerId: this.getMedicineDeskQueueOwnerId(clinicId),
        position: activeEntry?.position ?? activeEntry?.queuePosition ?? null,
        queuePosition: activeEntry?.queuePosition ?? activeEntry?.position ?? null,
        totalInQueue: activeEntry?.totalInQueue ?? 0,
        status: String(activeEntry?.status || 'WAITING_FOR_PAYMENT').toUpperCase(),
        paymentStatus: String(activeEntry?.paymentStatus || 'PENDING').toUpperCase(),
        pendingAmount: Number(activeEntry?.pendingAmount || 0),
        queueStatus: String(activeEntry?.queueStatus || 'PENDING').toUpperCase(),
        readyForHandover: Boolean(activeEntry?.readyForHandover),
      });
    } catch (error) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Failed to emit medicine desk queue update event',
        'PharmacyService',
        {
          clinicId,
          prescriptionId,
          action,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  private async getPrescriptionByIdForAccess(
    prescriptionId: string,
    clinicId?: string
  ): Promise<{
    id: string;
    clinicId: string;
    patientId: string;
    status: PrescriptionStatus | string;
    items: Array<{
      quantity?: number | null;
      medicineId?: string | null;
      medicine?: { price?: number | null } | null;
    }>;
    patient?: {
      user?: {
        id?: string | null;
        name?: string | null;
        email?: string | null;
        phone?: string | null;
      } | null;
    } | null;
  }> {
    const prescription = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.prescription.findUnique({
        where: { id: prescriptionId } as PrismaDelegateArgs,
        include: {
          items: {
            include: {
              medicine: true,
            },
          },
          patient: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                },
              },
            },
          },
          doctor: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          location: true,
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });

    if (!prescription) {
      throw new NotFoundException('Prescription not found');
    }

    if (clinicId && prescription.clinicId !== clinicId) {
      throw new BadRequestException('Prescription does not belong to this clinic');
    }

    return prescription as {
      id: string;
      clinicId: string;
      patientId: string;
      status: PrescriptionStatus | string;
      items: Array<{
        quantity?: number | null;
        medicineId?: string | null;
        medicine?: { price?: number | null } | null;
      }>;
      patient?: {
        user?: {
          id?: string | null;
          name?: string | null;
          email?: string | null;
          phone?: string | null;
        } | null;
      } | null;
    };
  }

  private ensurePatientOwnsPrescription(
    prescription: {
      patient?: { user?: { id?: string | null } | null } | null;
    },
    actorUserId?: string,
    actorRole?: string
  ) {
    if (actorRole === 'PATIENT' && prescription.patient?.user?.id !== actorUserId) {
      throw new ForbiddenException('Patients can only access their own prescriptions');
    }
  }

  async findAllMedicines(clinicId?: string, filters?: InventoryFilterOptions) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      const where: Record<string, unknown> = {};
      if (clinicId) where['clinicId'] = clinicId;

      const medicines = await typedClient.medicine.findMany({
        where: where as PrismaDelegateArgs,
      } as PrismaDelegateArgs);

      const normalizedExpiringDays = Math.max(1, Number(filters?.expiringDays || 90));
      const expiryThreshold = Date.now() + normalizedExpiringDays * 24 * 60 * 60 * 1000;

      return medicines.filter(medicine => {
        const stock = Number(medicine.stock || 0);
        const minStockThreshold = Number(medicine.minStockThreshold || 0);
        const expiryDate = medicine.expiryDate ? new Date(medicine.expiryDate).getTime() : null;

        if (filters?.lowStock && stock > minStockThreshold) {
          return false;
        }

        if (filters?.expiringSoon) {
          if (expiryDate === null) {
            return false;
          }

          if (expiryDate > expiryThreshold) {
            return false;
          }
        }

        return true;
      });
    });
  }

  async findMedicineById(id: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.medicine.findUnique({
        where: { id } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  async addMedicine(dto: CreateMedicineDto, clinicId?: string) {
    if (!clinicId) throw new BadRequestException('Clinic ID is required to add medicine');

    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        // Mapping DTO to Schema
        // Schema has: name, ingredients?, properties?, dosage?, manufacturer?, type, clinicId
        // DTO has: name, manufacturer, description, type, quantity, price, expiryDate, instructions
        // WE LOST: quantity, price, expiryDate
        return await typedClient.medicine.create({
          data: {
            name: dto.name,
            manufacturer: dto.manufacturer,
            type: dto.type,
            properties: dto.description, // Mapping description to properties
            dosage: dto.instructions, // Mapping instructions to dosage provided generic usage
            stock: dto.quantity, // Mapping quantity to stock
            price: dto.price,
            expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
            minStockThreshold: dto.minStockThreshold ?? 10,
            supplierId: dto.supplierId,
            clinicId: clinicId,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: 'system',
        clinicId: clinicId,
        resourceType: 'MEDICINE',
        operation: 'CREATE',
        resourceId: 'new',
        userRole: 'system',
        details: { name: dto.name },
      }
    );
  }

  async updateInventory(id: string, dto: UpdateInventoryDto, clinicId?: string) {
    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;

        const existing = await typedClient.medicine.findUnique({
          where: { id } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        if (!existing) {
          throw new BadRequestException('Medicine not found');
        }

        return await typedClient.medicine.update({
          where: { id } as PrismaDelegateArgs,
          data: {
            ...(dto.quantityChange !== undefined && {
              stock: { increment: dto.quantityChange },
            }),
            ...(dto.price !== undefined && { price: dto.price }),
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: 'system',
        clinicId: clinicId || 'unknown',
        resourceType: 'MEDICINE',
        operation: 'UPDATE',
        resourceId: id,
        userRole: 'system',
        details: { quantityChange: dto.quantityChange, price: dto.price },
      }
    );
  }

  async findAllPrescriptions(clinicId?: string) {
    const prescriptions = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      const where: Record<string, unknown> = {};
      if (clinicId) where['clinicId'] = clinicId;

      return await typedClient.prescription.findMany({
        where: where as PrismaDelegateArgs,
        include: {
          items: {
            include: {
              medicine: true,
            },
          },
          patient: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                },
              },
            },
          },
          doctor: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          location: true,
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });

    return await this.enrichPrescriptionsWithPaymentState(prescriptions, clinicId);
  }

  async findPrescriptionsByPatient(userId: string) {
    const result = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        patient: { findUnique: (args: PrismaDelegateArgs) => Promise<{ id: string } | null> };
      };

      // Resolve Patient ID from User ID
      const patient = await typedClient.patient.findUnique({
        where: { userId } as PrismaDelegateArgs,
        select: { id: true } as PrismaDelegateArgs,
      });

      if (!patient) {
        return [];
      }

      return await typedClient.prescription.findMany({
        where: { patientId: patient.id } as PrismaDelegateArgs,
        include: {
          items: {
            include: {
              medicine: true,
            },
          },
          doctor: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          patient: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                },
              },
            },
          },
          location: true,
        } as PrismaDelegateArgs,
        orderBy: { date: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });

    const clinicId = result[0]?.clinicId;
    return await this.enrichPrescriptionsWithPaymentState(result, clinicId);
  }

  async createPrescription(dto: CreatePrescriptionDto, clinicId?: string) {
    if (!clinicId) throw new BadRequestException('Clinic ID is required');

    const prescription = await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;

        return await typedClient.prescription.create({
          data: {
            patientId: dto.patientId,
            doctorId: dto.doctorId,
            clinicId: clinicId,
            notes: dto.notes,
            items: {
              create: dto.items.map(item => ({
                medicineId: item.medicineId,
                quantity: item.quantity,
                dosage: item.dosage,
                clinicId: clinicId,
              })),
            },
          } as PrismaDelegateArgs,
          include: {
            items: {
              include: {
                medicine: true,
              },
            },
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: dto.doctorId,
        clinicId: clinicId,
        resourceType: 'PRESCRIPTION',
        operation: 'CREATE',
        resourceId: 'new',
        userRole: 'system',
        details: { patientId: dto.patientId },
      }
    );

    await this.syncMedicineDeskQueueEntries([
      {
        id: String((prescription as { id?: string }).id),
        clinicId,
        patientId: String((prescription as { patientId?: string }).patientId || dto.patientId),
        doctorId: String((prescription as { doctorId?: string }).doctorId || dto.doctorId),
        locationId:
          (prescription as { locationId?: string | null }).locationId ||
          (dto as { locationId?: string | null }).locationId ||
          null,
        status:
          (prescription as { status?: PrescriptionStatus | string }).status ||
          PrescriptionStatus.PENDING,
        date: (prescription as { date?: Date | string | null }).date || new Date(),
      },
    ]);

    await this.emitMedicineDeskQueueUpdated(
      clinicId,
      String((prescription as { id?: string }).id),
      'CREATED'
    );
    return prescription;
  }

  /**
   * Update prescription status (dispense/cancel). Enforces immutability:
   * prescriptions with status FILLED cannot be modified.
   */
  async updatePrescriptionStatus(
    prescriptionId: string,
    status: PrescriptionStatus,
    clinicId?: string,
    notes?: string
  ) {
    if (status === PrescriptionStatus.FILLED) {
      return await this.dispensePrescription(prescriptionId, notes ? { notes } : {}, clinicId);
    }

    const prescription = await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;

        const existing = await typedClient.prescription.findUnique({
          where: { id: prescriptionId } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        if (!existing) {
          throw new BadRequestException('Prescription not found');
        }

        if (clinicId && existing.clinicId !== clinicId) {
          throw new BadRequestException('Prescription does not belong to this clinic');
        }

        // Immutability: reject updates when already FILLED
        if (String(existing.status) === 'FILLED') {
          throw new BadRequestException(
            'Cannot modify a prescription that has already been dispensed'
          );
        }

        if (String(existing.status) === 'CANCELLED' && String(status) !== 'CANCELLED') {
          throw new BadRequestException('Cannot update a cancelled prescription');
        }

        const updatedPrescription = await typedClient.prescription.update({
          where: { id: prescriptionId } as PrismaDelegateArgs,
          data: {
            status,
            ...(notes ? { notes } : {}),
          } as PrismaDelegateArgs,
          include: {
            items: {
              include: {
                medicine: true,
              },
            },
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        return updatedPrescription;
      },
      {
        userId: 'system',
        clinicId: clinicId ?? 'unknown',
        resourceType: 'PRESCRIPTION',
        operation: 'UPDATE',
        resourceId: prescriptionId,
        userRole: 'system',
        details: { status, ...(notes ? { notes } : {}) },
      }
    );

    const resolvedClinicId =
      clinicId || String((prescription as { clinicId?: string }).clinicId || '');
    if (resolvedClinicId) {
      await this.syncMedicineDeskQueueEntries([
        {
          id: String((prescription as { id?: string }).id),
          clinicId: resolvedClinicId,
          patientId: String((prescription as { patientId?: string }).patientId || ''),
          doctorId: String((prescription as { doctorId?: string }).doctorId || ''),
          locationId: (prescription as { locationId?: string | null }).locationId || null,
          status: (prescription as { status?: PrescriptionStatus | string }).status || status,
          date: (prescription as { date?: Date | string | null }).date || new Date(),
        },
      ]);
    }

    if (clinicId) {
      await this.emitMedicineDeskQueueUpdated(clinicId, prescriptionId, 'CANCELLED');
    }

    return prescription;
  }

  async dispensePrescription(
    prescriptionId: string,
    dto: DispensePrescriptionDto,
    clinicId?: string
  ) {
    const dispenseSummary = await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          prescriptionItem: {
            update: (args: PrismaDelegateArgs) => Promise<unknown>;
          };
        };

        const existing = await typedClient.prescription.findUnique({
          where: { id: prescriptionId } as PrismaDelegateArgs,
          include: {
            items: {
              include: {
                medicine: true,
              },
            },
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        if (!existing) {
          throw new NotFoundException('Prescription not found');
        }

        if (clinicId && existing.clinicId !== clinicId) {
          throw new BadRequestException('Prescription does not belong to this clinic');
        }

        const normalizedStatus = String(existing.status || '').toUpperCase();
        if (normalizedStatus === 'CANCELLED') {
          throw new BadRequestException('Cancelled prescriptions cannot be dispensed');
        }

        if (normalizedStatus === 'FILLED') {
          throw new BadRequestException(
            'Cannot modify a prescription that has already been dispensed'
          );
        }

        const existingItems = (existing.items || []) as PrescriptionDispenseItem[];
        const payments = await this.databaseService.findPaymentsSafe({
          clinicId: existing.clinicId,
        });
        const paymentState = this.buildPrescriptionPaymentState(
          {
            id: String(existing.id),
            date: existing.date,
            items: existingItems,
          },
          payments
        );

        if (!paymentState.canDispense) {
          throw new BadRequestException(
            `Prescription payment is pending. Remaining amount: INR ${paymentState.pendingAmount}`
          );
        }

        const requestItems = this.normalizeDispenseRequestItems(dto.items);
        const effectiveRequestItems =
          requestItems.length > 0
            ? requestItems
            : this.buildFullDispenseRequestItems(existingItems);

        if (effectiveRequestItems.length === 0) {
          throw new BadRequestException('Prescription has already been fully dispensed');
        }

        const existingByItemId = new Map(
          existingItems
            .filter(item => Boolean(item.id))
            .map(item => [String(item.id), item] as const)
        );
        const existingByMedicineId = new Map<string, PrescriptionDispenseItem[]>();
        for (const item of existingItems) {
          if (!item.medicineId) {
            continue;
          }

          const key = String(item.medicineId);
          const currentItems = existingByMedicineId.get(key) || [];
          currentItems.push(item);
          existingByMedicineId.set(key, currentItems);
        }
        const inventoryMedicineIds = Array.from(
          new Set(
            effectiveRequestItems.flatMap(item =>
              [item.medicineId, item.substituteMedicineId].filter(Boolean)
            )
          )
        ) as string[];
        const inventoryMedicines = inventoryMedicineIds.length
          ? await typedClient.medicine.findMany({
              where: {
                clinicId: existing.clinicId,
                id: {
                  in: inventoryMedicineIds,
                },
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs)
          : [];
        const medicineById = new Map(
          inventoryMedicines.map(medicine => [String(medicine.id), medicine] as const)
        );
        const dispenseAt = dto.dispensedAt ? new Date(dto.dispensedAt) : new Date();

        if (Number.isNaN(dispenseAt.getTime())) {
          throw new BadRequestException('Invalid dispensedAt value');
        }

        let totalRequestedQuantity = 0;
        let totalDispensedQuantity = 0;
        const appliedRequests: Array<{
          prescriptionItemId: string;
          requestItem: PrescriptionDispenseRequestItem;
          inventoryMedicineId: string;
          lotHistory: PrescriptionDispenseBatchHistoryEntry[];
          eventHistory: PrescriptionDispenseBatchHistoryEntry[];
        }> = [];

        for (const requestItem of effectiveRequestItems) {
          const inventoryMedicineId = requestItem.substituteMedicineId || requestItem.medicineId;
          const inventoryMedicine = medicineById.get(inventoryMedicineId);

          if (!inventoryMedicine) {
            throw new BadRequestException(
              requestItem.substituteMedicineId
                ? `Substitute medicine ${inventoryMedicineId} is not part of this clinic inventory`
                : `Medicine ${requestItem.medicineId} is not part of this clinic inventory`
            );
          }

          const prescriptionItem = requestItem.prescriptionItemId
            ? existingByItemId.get(requestItem.prescriptionItemId)
            : (existingByMedicineId.get(requestItem.medicineId) || []).find(
                item => this.getPrescriptionItemRemainingQuantity(item) > 0
              );

          if (!prescriptionItem) {
            throw new BadRequestException(
              requestItem.prescriptionItemId
                ? `Prescription item ${requestItem.prescriptionItemId} is not part of this prescription`
                : `Medicine ${requestItem.medicineId} is not part of this prescription`
            );
          }

          const remainingQuantity = this.getPrescriptionItemRemainingQuantity(prescriptionItem);
          if (remainingQuantity <= 0) {
            throw new BadRequestException(
              `Medicine ${requestItem.medicineId} has already been fully dispensed`
            );
          }

          if (requestItem.quantity > remainingQuantity) {
            throw new BadRequestException(
              `Requested quantity for medicine ${requestItem.medicineId} exceeds remaining quantity (${remainingQuantity})`
            );
          }

          const availableStock = Number(inventoryMedicine.stock || 0);
          if (availableStock < requestItem.quantity) {
            throw new BadRequestException(
              `Insufficient stock for medicine ${inventoryMedicineId}. Available: ${availableStock}, requested: ${requestItem.quantity}`
            );
          }

          const requestLots =
            requestItem.lots.length > 0
              ? requestItem.lots
              : [
                  {
                    quantity: requestItem.quantity,
                  },
                ];
          const lotHistory: PrescriptionDispenseBatchHistoryEntry[] = requestLots.map(lot => ({
            quantity: Number(lot.quantity || 0),
            ...(lot.batchNumber ? { batchNumber: lot.batchNumber } : {}),
            ...(lot.expiryDate ? { expiryDate: lot.expiryDate } : {}),
            medicineId: inventoryMedicineId,
            originalMedicineId: requestItem.medicineId,
            ...(requestItem.substituteMedicineId
              ? { substituteMedicineId: requestItem.substituteMedicineId }
              : {}),
            eventType: requestItem.substituteMedicineId
              ? ('SUBSTITUTION' as const)
              : ('DISPENSE' as const),
            ...(requestItem.substitutionReason ? { reason: requestItem.substitutionReason } : {}),
            dispensedAt: dispenseAt.toISOString(),
          }));
          const eventHistory = requestLots.map(lot =>
            this.buildDispenseEventHistoryEntry({
              quantity: Number(lot.quantity || 0),
              medicineId: inventoryMedicineId,
              originalMedicineId: requestItem.medicineId,
              ...(requestItem.substituteMedicineId
                ? { substituteMedicineId: requestItem.substituteMedicineId }
                : {}),
              ...(lot.batchNumber ? { batchNumber: lot.batchNumber } : {}),
              ...(lot.expiryDate ? { expiryDate: lot.expiryDate } : {}),
              eventType: requestItem.substituteMedicineId ? 'SUBSTITUTION' : 'DISPENSE',
              ...(requestItem.substitutionReason ? { reason: requestItem.substitutionReason } : {}),
              dispensedAt: dispenseAt,
            })
          );
          const latestBatchNumber =
            [...requestLots].reverse().find(lot => Boolean(lot.batchNumber))?.batchNumber || null;
          const latestBatchExpiryDate =
            [...requestLots].reverse().find(lot => Boolean(lot.expiryDate))?.expiryDate || null;

          totalRequestedQuantity += requestItem.quantity;
          totalDispensedQuantity += requestItem.quantity;

          await typedClient.medicine.update({
            where: { id: inventoryMedicineId } as PrismaDelegateArgs,
            data: {
              stock: { decrement: requestItem.quantity },
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);

          const nextDispensedQuantity =
            Number(prescriptionItem.dispensedQuantity || 0) + requestItem.quantity;

          await typedClient.prescriptionItem.update({
            where: { id: String(prescriptionItem.id) } as PrismaDelegateArgs,
            data: {
              dispensedQuantity: nextDispensedQuantity,
              dispensedAt: dispenseAt,
              ...(latestBatchNumber ? { dispensedBatchNumber: latestBatchNumber } : {}),
              ...(latestBatchExpiryDate
                ? { dispensedBatchExpiryDate: new Date(latestBatchExpiryDate) }
                : {}),
              dispenseBatchHistory: this.appendDispenseHistory(
                prescriptionItem.dispenseBatchHistory || null,
                lotHistory
              ),
              dispenseEventHistory: this.appendDispenseEventHistory(
                prescriptionItem.dispenseEventHistory || null,
                eventHistory
              ),
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);

          appliedRequests.push({
            prescriptionItemId: String(prescriptionItem.id),
            requestItem,
            inventoryMedicineId,
            lotHistory,
            eventHistory,
          });
        }

        const requestItemsByItemId = new Map(
          effectiveRequestItems
            .filter(item => Boolean(item.prescriptionItemId))
            .map(item => [String(item.prescriptionItemId), item] as const)
        );
        const requestItemsByMedicineId = new Map<string, PrescriptionDispenseRequestItem[]>();
        for (const item of effectiveRequestItems) {
          if (item.prescriptionItemId) {
            continue;
          }

          const currentItems = requestItemsByMedicineId.get(item.medicineId) || [];
          currentItems.push(item);
          requestItemsByMedicineId.set(item.medicineId, currentItems);
        }

        const updatedItems = existingItems.map(item => {
          const requestItem = item.id
            ? requestItemsByItemId.get(String(item.id))
            : item.medicineId
              ? (requestItemsByMedicineId.get(String(item.medicineId)) || [])[0]
              : undefined;
          const dispensedQuantity = Number(item.dispensedQuantity || 0);
          const nextDispensedQuantity = requestItem
            ? dispensedQuantity + requestItem.quantity
            : dispensedQuantity;
          const appliedRequest = item.id
            ? appliedRequests.find(entry => entry.prescriptionItemId === String(item.id))
            : item.medicineId
              ? appliedRequests.find(
                  entry => entry.requestItem.medicineId === String(item.medicineId)
                )
              : undefined;
          const requestLots =
            appliedRequest?.requestItem.lots && appliedRequest.requestItem.lots.length > 0
              ? appliedRequest.requestItem.lots
              : requestItem
                ? [{ quantity: requestItem.quantity }]
                : [];
          const latestBatchNumber =
            [...requestLots].reverse().find(lot => Boolean(lot.batchNumber))?.batchNumber || null;
          const latestBatchExpiryDate =
            [...requestLots].reverse().find(lot => Boolean(lot.expiryDate))?.expiryDate || null;

          return {
            ...item,
            dispensedQuantity: nextDispensedQuantity,
            dispensedAt: requestItem ? dispenseAt : item.dispensedAt || null,
            ...(latestBatchNumber ? { dispensedBatchNumber: latestBatchNumber } : {}),
            ...(latestBatchExpiryDate
              ? { dispensedBatchExpiryDate: new Date(latestBatchExpiryDate) }
              : {}),
            ...(requestItem
              ? {
                  dispenseBatchHistory: this.appendDispenseHistory(
                    item.dispenseBatchHistory || null,
                    appliedRequest?.lotHistory || []
                  ),
                  dispenseEventHistory: this.appendDispenseEventHistory(
                    item.dispenseEventHistory || null,
                    appliedRequest?.eventHistory || []
                  ),
                }
              : {}),
          };
        });

        const nextStatus = this.getPrescriptionDispenseStatus(updatedItems);
        const remainingQuantity = updatedItems.reduce(
          (sum, item) => sum + this.getPrescriptionItemRemainingQuantity(item),
          0
        );

        await typedClient.prescription.update({
          where: { id: prescriptionId } as PrismaDelegateArgs,
          data: {
            status: nextStatus,
            ...(dto.notes ? { notes: dto.notes } : {}),
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        return {
          status: nextStatus,
          dispensedAt: dispenseAt,
          totalRequestedQuantity,
          totalDispensedQuantity,
          remainingQuantity,
        };
      },
      {
        userId: 'system',
        clinicId: clinicId ?? 'unknown',
        resourceType: 'PRESCRIPTION',
        operation: 'UPDATE',
        resourceId: prescriptionId,
        userRole: 'system',
        details: {
          action: 'DISPENSE',
          ...(dto.notes ? { notes: dto.notes } : {}),
        },
      }
    );

    const hydratedPrescription = await this.getPrescriptionByIdForAccess(prescriptionId, clinicId);
    const resolvedClinicId = clinicId || String(hydratedPrescription.clinicId || '');
    const [enrichedPrescription] = await this.enrichPrescriptionsWithPaymentState(
      [
        hydratedPrescription as unknown as {
          id: string;
          clinicId: string;
          patientId?: string;
          doctorId?: string;
          locationId?: string | null;
          date?: Date | string | null;
          status?: PrescriptionStatus | string | null;
          items?: PrescriptionDispenseItem[];
          patient?: {
            id?: string;
            name?: string | null;
            user?: {
              id?: string | null;
              name?: string | null;
              phone?: string | null;
              email?: string | null;
            } | null;
          } | null;
          doctor?: {
            id?: string;
            name?: string | null;
            user?: {
              id?: string | null;
              name?: string | null;
              role?: string | null;
            } | null;
          } | null;
          location?: {
            id?: string;
            name?: string | null;
          } | null;
        },
      ],
      resolvedClinicId || undefined
    );

    if (resolvedClinicId) {
      await this.emitMedicineDeskQueueUpdated(
        resolvedClinicId,
        prescriptionId,
        String(dispenseSummary.status || '').toUpperCase() === 'FILLED'
          ? 'DISPENSED'
          : 'PARTIALLY_DISPENSED'
      );
    }

    return {
      ...enrichedPrescription,
      dispenseSummary,
    };
  }

  async reversePrescriptionDispense(
    prescriptionId: string,
    dto: { reason: string; items?: Array<{ prescriptionItemId?: string; quantity?: number }> },
    clinicId?: string
  ) {
    const reversalSummary = await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          prescriptionItem: {
            update: (args: PrismaDelegateArgs) => Promise<unknown>;
          };
        };

        const existing = await typedClient.prescription.findUnique({
          where: { id: prescriptionId } as PrismaDelegateArgs,
          include: {
            items: {
              include: {
                medicine: true,
              },
            },
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        if (!existing) {
          throw new NotFoundException('Prescription not found');
        }

        if (clinicId && existing.clinicId !== clinicId) {
          throw new BadRequestException('Prescription does not belong to this clinic');
        }

        const existingItems = (existing.items || []) as PrescriptionDispenseItem[];
        const targetItemIds = (dto.items || [])
          .map(item => item.prescriptionItemId)
          .filter((value): value is string => Boolean(value));
        const itemsToReverse =
          targetItemIds.length > 0
            ? existingItems.filter(item => targetItemIds.includes(String(item.id || '')))
            : existingItems.filter(item => Number(item.dispensedQuantity || 0) > 0);

        if (itemsToReverse.length === 0) {
          throw new BadRequestException(
            'No dispensed prescription items are available for reversal'
          );
        }

        const now = new Date();
        const reversedItemIds: string[] = [];

        for (const item of itemsToReverse) {
          const requestedReversalQuantity = (dto.items || []).find(
            reversalItem => String(reversalItem.prescriptionItemId || '') === String(item.id || '')
          )?.quantity;
          const currentDispensedQuantity = Number(item.dispensedQuantity || 0);
          if (
            typeof requestedReversalQuantity === 'number' &&
            requestedReversalQuantity > 0 &&
            requestedReversalQuantity !== currentDispensedQuantity
          ) {
            throw new BadRequestException(
              `Reversal quantity for item ${item.id} must match the currently dispensed quantity (${currentDispensedQuantity})`
            );
          }

          const eventHistory = this.normalizeStoredDispenseEventHistory(
            item.dispenseEventHistory || item.dispenseBatchHistory || null
          );
          const reversibleEvents = eventHistory.filter(
            entry => entry.eventType !== 'REVERSAL' && !entry.reversedAt
          );

          if (reversibleEvents.length === 0) {
            continue;
          }

          const reversalTotal = reversibleEvents.reduce(
            (sum, entry) => sum + Number(entry.quantity || 0),
            0
          );
          const medicineUpdates = reversibleEvents.reduce((accumulator, entry) => {
            const medicineId = String(entry.medicineId || item.medicineId || '');
            if (!medicineId) {
              return accumulator;
            }

            accumulator.set(
              medicineId,
              (accumulator.get(medicineId) || 0) + Number(entry.quantity || 0)
            );
            return accumulator;
          }, new Map<string, number>());

          for (const [medicineId, quantity] of medicineUpdates.entries()) {
            await typedClient.medicine.update({
              where: { id: medicineId } as PrismaDelegateArgs,
              data: {
                stock: { increment: quantity },
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }

          const updatedEventHistory = eventHistory.map(entry => {
            if (entry.eventType === 'REVERSAL' || entry.reversedAt) {
              return entry;
            }

            return {
              ...entry,
              reversedAt: now.toISOString(),
              reversalReason: dto.reason,
            };
          });

          const latestReversibleEvent = reversibleEvents[reversibleEvents.length - 1];
          const originalReversibleEvent = reversibleEvents[0];
          const reversalEvent = this.buildDispenseEventHistoryEntry({
            quantity: reversalTotal,
            medicineId: String(latestReversibleEvent?.medicineId || item.medicineId || ''),
            originalMedicineId: String(
              item.medicineId || originalReversibleEvent?.originalMedicineId || ''
            ),
            eventType: 'REVERSAL',
            reason: dto.reason,
            dispensedAt: now,
            reversedAt: now,
            reversalReason: dto.reason,
          });

          await typedClient.prescriptionItem.update({
            where: { id: String(item.id) } as PrismaDelegateArgs,
            data: {
              dispensedQuantity: 0,
              dispensedAt: null,
              dispensedBatchNumber: null,
              dispensedBatchExpiryDate: null,
              dispenseBatchHistory: this.appendDispenseHistory(item.dispenseBatchHistory || null, [
                ...reversibleEvents.map(entry =>
                  this.buildDispenseEventHistoryEntry({
                    quantity: Number(entry.quantity || 0),
                    medicineId: String(entry.medicineId || item.medicineId || ''),
                    originalMedicineId: String(entry.originalMedicineId || item.medicineId || ''),
                    ...(entry.substituteMedicineId
                      ? { substituteMedicineId: entry.substituteMedicineId }
                      : {}),
                    ...(entry.batchNumber ? { batchNumber: entry.batchNumber } : {}),
                    ...(entry.expiryDate ? { expiryDate: entry.expiryDate } : {}),
                    eventType: 'REVERSAL',
                    ...(entry.reason ? { reason: entry.reason } : {}),
                    dispensedAt: new Date(entry.dispensedAt),
                    reversedAt: now,
                    reversalReason: dto.reason,
                  })
                ),
              ]),
              dispenseEventHistory: [...updatedEventHistory, reversalEvent],
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);

          reversedItemIds.push(String(item.id));
        }

        const refreshedItems = existingItems.map(item =>
          reversedItemIds.includes(String(item.id))
            ? {
                ...item,
                dispensedQuantity: 0,
                dispensedAt: null,
                dispensedBatchNumber: null,
                dispensedBatchExpiryDate: null,
              }
            : item
        );
        const nextStatus = this.getPrescriptionDispenseStatus(refreshedItems);

        await typedClient.prescription.update({
          where: { id: prescriptionId } as PrismaDelegateArgs,
          data: {
            status: nextStatus,
            notes: `${existing.notes ? `${existing.notes}\n` : ''}Reversal: ${dto.reason}`.trim(),
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        return {
          reversedItemCount: reversedItemIds.length,
          status: nextStatus,
          reversedAt: now.toISOString(),
        };
      },
      {
        userId: 'system',
        clinicId: clinicId ?? 'unknown',
        resourceType: 'PRESCRIPTION',
        operation: 'UPDATE',
        resourceId: prescriptionId,
        userRole: 'system',
        details: {
          action: 'REVERSE_DISPENSE',
          reason: dto.reason,
        },
      }
    );

    const hydratedPrescription = await this.getPrescriptionByIdForAccess(prescriptionId, clinicId);
    const resolvedClinicId = clinicId || String(hydratedPrescription.clinicId || '');

    if (resolvedClinicId) {
      await this.emitMedicineDeskQueueUpdated(
        resolvedClinicId,
        prescriptionId,
        String(reversalSummary.status || '').toUpperCase() === 'FILLED'
          ? 'DISPENSED'
          : 'PARTIALLY_DISPENSED'
      );
      await this.eventService.emit('pharmacy.medicine_desk.updated', {
        clinicId: resolvedClinicId,
        prescriptionId,
        action: 'PRESCRIPTION_REVERSED',
      });
    }

    return {
      ...hydratedPrescription,
      reversalSummary,
    };
  }

  async getPharmacyBatchAudit(
    clinicId?: string,
    filters?: {
      prescriptionId?: string;
      medicineId?: string;
      batchNumber?: string;
      patientId?: string;
      startDate?: string;
      endDate?: string;
    }
  ): Promise<PharmacyBatchAuditEntry[]> {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      const where: Record<string, unknown> = {};
      if (clinicId) where['clinicId'] = clinicId;
      if (filters?.prescriptionId) where['id'] = filters.prescriptionId;

      const prescriptions = (await typedClient.prescription.findMany({
        where: where as PrismaDelegateArgs,
        include: {
          items: {
            include: {
              medicine: true,
            },
          },
          patient: {
            include: {
              user: true,
            },
          },
          doctor: {
            include: {
              user: true,
            },
          },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as Array<{
        id: string;
        clinicId: string;
        patientId: string;
        doctorId: string;
        patient?: {
          user?: { name?: string | null } | null;
        } | null;
        doctor?: {
          user?: { name?: string | null } | null;
        } | null;
        items?: PrescriptionDispenseItem[];
      }>;

      const medicineIds = new Set<string>();
      for (const prescription of prescriptions) {
        for (const item of prescription.items || []) {
          if (item.medicineId) {
            medicineIds.add(String(item.medicineId));
          }
          for (const event of this.normalizeStoredDispenseEventHistory(
            item.dispenseEventHistory || item.dispenseBatchHistory || null
          )) {
            if (event.medicineId) medicineIds.add(String(event.medicineId));
            if (event.originalMedicineId) medicineIds.add(String(event.originalMedicineId));
            if (event.substituteMedicineId) medicineIds.add(String(event.substituteMedicineId));
          }
        }
      }

      const medicineRecords = medicineIds.size
        ? await typedClient.medicine.findMany({
            where: {
              clinicId: clinicId || undefined,
              id: { in: Array.from(medicineIds) },
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs)
        : [];
      const medicineById = new Map(
        medicineRecords.map(medicine => [String(medicine.id), medicine] as const)
      );

      const startTime = filters?.startDate ? new Date(filters.startDate).getTime() : null;
      const endTime = filters?.endDate ? new Date(filters.endDate).getTime() : null;

      const entries: PharmacyBatchAuditEntry[] = [];

      for (const prescription of prescriptions) {
        if (filters?.patientId && prescription.patientId !== filters.patientId) {
          continue;
        }

        const patientName =
          prescription.patient?.user?.name || `Patient ${prescription.patientId.slice(0, 8)}`;
        const doctorName =
          prescription.doctor?.user?.name || `Doctor ${prescription.doctorId.slice(0, 8)}`;

        for (const item of prescription.items || []) {
          const normalizedEvents = this.normalizeStoredDispenseEventHistory(
            item.dispenseEventHistory || item.dispenseBatchHistory || null
          );

          for (const event of normalizedEvents) {
            const eventAt = event.reversedAt || event.dispensedAt;
            const eventTimestamp = new Date(eventAt).getTime();

            if (Number.isNaN(eventTimestamp)) {
              continue;
            }

            if (startTime !== null && eventTimestamp < startTime) {
              continue;
            }

            if (endTime !== null && eventTimestamp > endTime) {
              continue;
            }

            if (filters?.batchNumber && String(event.batchNumber || '') !== filters.batchNumber) {
              continue;
            }

            const medicineId = String(
              event.medicineId || item.medicineId || event.originalMedicineId || ''
            );
            const originalMedicineId = String(
              event.originalMedicineId || item.medicineId || medicineId
            );
            const substituteMedicineId = event.substituteMedicineId || null;

            if (
              filters?.medicineId &&
              ![
                medicineId,
                originalMedicineId,
                substituteMedicineId || '',
                String(item.medicineId || ''),
              ].includes(filters.medicineId)
            ) {
              continue;
            }

            entries.push({
              prescriptionId: prescription.id,
              prescriptionItemId: String(item.id || ''),
              patientId: prescription.patientId,
              patientName,
              doctorId: prescription.doctorId,
              doctorName,
              medicineId,
              medicineName: String(
                medicineById.get(medicineId)?.name || item.medicine?.name || 'Medicine'
              ),
              originalMedicineId,
              originalMedicineName: String(
                medicineById.get(originalMedicineId)?.name || item.medicine?.name || 'Medicine'
              ),
              ...(substituteMedicineId
                ? {
                    substituteMedicineId,
                    substituteMedicineName: String(
                      medicineById.get(substituteMedicineId)?.name || substituteMedicineId
                    ),
                  }
                : {}),
              ...(event.batchNumber ? { batchNumber: event.batchNumber } : {}),
              ...(event.expiryDate ? { expiryDate: event.expiryDate } : {}),
              quantity: Number(event.quantity || 0),
              eventType: event.eventType || 'DISPENSE',
              eventAt,
              ...(event.reason ? { reason: event.reason } : {}),
              ...(event.reversedAt ? { reversedAt: event.reversedAt } : {}),
              ...(event.reversalReason ? { reversalReason: event.reversalReason } : {}),
            });
          }
        }
      }

      return entries.sort(
        (left, right) => new Date(right.eventAt).getTime() - new Date(left.eventAt).getTime()
      );
    });
  }

  async getStats(clinicId?: string) {
    // Simple count stats
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;

      const where: Record<string, unknown> = {};
      if (clinicId) where['clinicId'] = clinicId;

      const totalMedicines = await typedClient.medicine.count({
        where: where as PrismaDelegateArgs,
      } as PrismaDelegateArgs);

      const totalPrescriptions = await typedClient.prescription.count({
        where: where as PrismaDelegateArgs,
      } as PrismaDelegateArgs);

      const prescriptions = await typedClient.prescription.findMany({
        where: where as PrismaDelegateArgs,
        include: {
          items: {
            include: {
              medicine: true,
            },
          },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);

      const enrichedPrescriptions = await this.enrichPrescriptionsWithPaymentState(
        prescriptions as Array<{
          id: string;
          clinicId: string;
          date?: Date | string | null;
          status?: PrescriptionStatus | string | null;
          items?: PrescriptionDispenseItem[];
        }>,
        clinicId
      );

      // Fetch medicine stock levels to calculate low stock
      const medicines = await typedClient.medicine.findMany({
        where: where as PrismaDelegateArgs,
        select: { stock: true, minStockThreshold: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);

      const lowStockCount = medicines.filter(
        m => (m.stock ?? 0) <= (m.minStockThreshold ?? 0)
      ).length;

      return {
        totalMedicines,
        lowStock: lowStockCount,
        totalPrescriptions,
        pendingPrescriptions: enrichedPrescriptions.filter(prescription =>
          Boolean((prescription as { activeQueueEntry?: boolean }).activeQueueEntry)
        ).length,
        awaitingPaymentPrescriptions: enrichedPrescriptions.filter(
          prescription =>
            Boolean((prescription as { activeQueueEntry?: boolean }).activeQueueEntry) &&
            String(
              (prescription as { paymentStatus?: string }).paymentStatus || 'PENDING'
            ).toUpperCase() !== 'PAID'
        ).length,
        readyToDispensePrescriptions: enrichedPrescriptions.filter(
          prescription =>
            Boolean((prescription as { activeQueueEntry?: boolean }).activeQueueEntry) &&
            String(
              (prescription as { paymentStatus?: string }).paymentStatus || 'PENDING'
            ).toUpperCase() === 'PAID'
        ).length,
      };
    });
  }

  async getMedicineDeskQueue(clinicId?: string) {
    const prescriptions = await this.findAllPrescriptions(clinicId);
    return prescriptions
      .filter(prescription =>
        Boolean((prescription as { activeQueueEntry?: boolean }).activeQueueEntry)
      )
      .sort((left, right) => {
        const leftPosition = Number(
          (left as { position?: number | null; queuePosition?: number | null }).position ||
            (left as { queuePosition?: number | null }).queuePosition ||
            0
        );
        const rightPosition = Number(
          (right as { position?: number | null; queuePosition?: number | null }).position ||
            (right as { queuePosition?: number | null }).queuePosition ||
            0
        );
        return leftPosition - rightPosition;
      });
  }

  // ============ Supplier Management ============

  async findAllSuppliers(clinicId?: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        supplier: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
      };
      const where: Record<string, unknown> = { isActive: true };
      if (clinicId) where['clinicId'] = clinicId;

      return await typedClient.supplier.findMany({
        where: where as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  async addSupplier(dto: CreateSupplierDto, clinicId: string) {
    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          supplier: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.supplier.create({
          data: {
            ...(dto as unknown as Record<string, unknown>),
            clinicId,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: 'system',
        clinicId,
        resourceType: 'SUPPLIER',
        operation: 'CREATE',
        resourceId: 'new',
        userRole: 'system',
        details: { name: (dto as unknown as Record<string, unknown>)['name'] },
      }
    );
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto, clinicId: string) {
    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          supplier: { update: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.supplier.update({
          where: { id } as PrismaDelegateArgs,
          data: dto as unknown as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: 'system',
        clinicId,
        resourceType: 'SUPPLIER',
        operation: 'UPDATE',
        resourceId: id,
        userRole: 'system',
        details: dto as unknown as Record<string, unknown>,
      }
    );
  }

  async findLowStock(clinicId?: string) {
    return await this.findAllMedicines(clinicId, { lowStock: true });
  }

  async findExpiringSoon(clinicId?: string, expiringDays: number = 90) {
    return await this.findAllMedicines(clinicId, {
      expiringSoon: true,
      expiringDays,
    });
  }

  async getPrescriptionPaymentSummary(
    prescriptionId: string,
    clinicId?: string,
    actor?: { userId?: string; role?: string }
  ) {
    const prescription = await this.getPrescriptionByIdForAccess(prescriptionId, clinicId);
    this.ensurePatientOwnsPrescription(prescription, actor?.userId, actor?.role);

    const payments = await this.databaseService.findPaymentsSafe({
      clinicId: prescription.clinicId,
    });
    const paymentState = this.buildPrescriptionPaymentState(prescription, payments);

    return {
      prescriptionId: prescription.id,
      status: prescription.status,
      totalAmount: paymentState.totalAmount,
      paidAmount: paymentState.paidAmount,
      pendingAmount: paymentState.pendingAmount,
      paymentStatus: paymentState.paymentStatus,
      canDispense: paymentState.canDispense,
    };
  }

  async createPrescriptionPaymentIntent(
    prescriptionId: string,
    clinicId?: string,
    actor?: { userId?: string; role?: string },
    provider?: string
  ) {
    const prescription = await this.getPrescriptionByIdForAccess(prescriptionId, clinicId);
    this.ensurePatientOwnsPrescription(prescription, actor?.userId, actor?.role);

    if (String(prescription.status) === 'CANCELLED') {
      throw new BadRequestException('Cancelled prescriptions cannot be paid');
    }

    if (String(prescription.status) === 'FILLED') {
      throw new BadRequestException('Prescription has already been dispensed');
    }

    const paymentState = await this.getPrescriptionPaymentSummary(prescriptionId, clinicId, actor);

    if (paymentState.pendingAmount <= 0) {
      return {
        alreadyPaid: true,
        ...paymentState,
        prescriptionId,
      };
    }

    const normalizedProvider = this.normalizePaymentProvider(provider);
    const customerId = prescription.patient?.user?.id || actor?.userId;
    const paymentIntentOptions: PaymentIntentOptions = {
      amount: Math.round(paymentState.pendingAmount * 100),
      currency: 'INR',
      ...(typeof customerId === 'string' && customerId ? { customerId } : {}),
      ...(prescription.patient?.user?.email && { customerEmail: prescription.patient.user.email }),
      ...(prescription.patient?.user?.phone && { customerPhone: prescription.patient.user.phone }),
      ...(prescription.patient?.user?.name && { customerName: prescription.patient.user.name }),
      description: `Prescription payment for ${prescription.id}`,
      clinicId: prescription.clinicId,
      metadata: this.getPrescriptionPaymentMetadata(prescription.id),
    };

    const paymentIntentResult: PaymentResult = await this.paymentService.createPaymentIntent(
      prescription.clinicId,
      paymentIntentOptions,
      normalizedProvider
    );

    const paymentRecord = await this.databaseService.createPaymentSafe({
      amount: paymentState.pendingAmount,
      clinicId: prescription.clinicId,
      ...(prescription.patient?.user?.id && { userId: prescription.patient.user.id }),
      status: PaymentStatus.PENDING,
      ...(paymentIntentResult.paymentId || paymentIntentResult.orderId
        ? { transactionId: paymentIntentResult.paymentId || paymentIntentResult.orderId }
        : {}),
      description: `Prescription payment for ${prescription.id}`,
      metadata: {
        ...(this.asRecord(paymentIntentResult.metadata) || {}),
        ...this.getPrescriptionPaymentMetadata(prescription.id),
      },
    });

    paymentIntentResult.metadata = {
      ...(this.asRecord(paymentIntentResult.metadata) || {}),
      paymentRecordId: paymentRecord.id,
      prescriptionId: prescription.id,
      clinicId: prescription.clinicId,
    };

    return {
      ...paymentState,
      prescriptionId: prescription.id,
      paymentId: paymentRecord.id,
      paymentIntent: paymentIntentResult,
    };
  }
}
