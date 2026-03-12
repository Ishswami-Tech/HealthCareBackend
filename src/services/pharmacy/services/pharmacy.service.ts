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

  private getPrescriptionTotal(prescription: {
    items?: Array<{ quantity?: number | null; medicine?: { price?: number | null } | null }>;
  }): number {
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
      items?: Array<{ quantity?: number | null; medicine?: { price?: number | null } | null }>;
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
      status: lifecycleStatus,
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
      items?: Array<{
        quantity?: number | null;
        medicine?: { price?: number | null; name?: string | null } | null;
      }>;
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
    action: 'CREATED' | 'PAYMENT_UPDATED' | 'DISPENSED' | 'CANCELLED'
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

  async findAllMedicines(clinicId?: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      const where: Record<string, unknown> = {};
      if (clinicId) where['clinicId'] = clinicId;

      return await typedClient.medicine.findMany({
        where: where as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
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
    clinicId?: string
  ) {
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

        const payments = await this.databaseService.findPaymentsSafe({
          clinicId: existing.clinicId,
        });

        const updatedPrescription = await typedClient.prescription.update({
          where: { id: prescriptionId } as PrismaDelegateArgs,
          data: { status } as PrismaDelegateArgs,
          include: {
            items: {
              include: {
                medicine: true,
              },
            },
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        const paymentState = this.buildPrescriptionPaymentState(updatedPrescription, payments);

        if (status === PrescriptionStatus.FILLED && !paymentState.canDispense) {
          throw new BadRequestException(
            `Prescription payment is pending. Remaining amount: INR ${paymentState.pendingAmount}`
          );
        }

        if (status === PrescriptionStatus.FILLED && updatedPrescription.items) {
          for (const item of updatedPrescription.items) {
            if (item.medicineId) {
              await typedClient.medicine.update({
                where: { id: item.medicineId } as PrismaDelegateArgs,
                data: {
                  stock: { decrement: item.quantity || 1 },
                } as PrismaDelegateArgs,
              });
            }
          }
        }

        return updatedPrescription;
      },
      {
        userId: 'system',
        clinicId: clinicId ?? 'unknown',
        resourceType: 'PRESCRIPTION',
        operation: 'UPDATE',
        resourceId: prescriptionId,
        userRole: 'system',
        details: { status },
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
      await this.emitMedicineDeskQueueUpdated(
        clinicId,
        prescriptionId,
        status === PrescriptionStatus.FILLED ? 'DISPENSED' : 'CANCELLED'
      );
    }

    return prescription;
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
          items?: Array<{
            quantity?: number | null;
            medicine?: { price?: number | null } | null;
          }>;
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
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      const where: Record<string, unknown> = {};
      if (clinicId) where['clinicId'] = clinicId;

      // Prisma cannot compare two columns directly in the current delegate path,
      // so we fetch clinic medicines and apply the threshold filter here.
      const medicines = await typedClient.medicine.findMany({
        where: where as PrismaDelegateArgs,
      } as PrismaDelegateArgs);

      return medicines.filter(m => (m.stock ?? 0) <= (m.minStockThreshold ?? 0));
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
