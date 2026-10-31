/**
 * Handover Service (pharmacy counter hand-over)
 * @module ClinicOps
 * @description Verified hand-over of a prescription at the pharmacy counter: the patient shows a QR
 * or reads a 6-digit code (issued in the patient app), the pharmacist verifies it, ticks every item
 * handed over, records who received the medicines (+ signature) and may undo for a short window.
 * Stock movement stays in the existing dispense / reverse-dispense endpoints; this records the
 * verified physical hand-over on top of them.
 */

import { randomInt } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { EventService } from '@infrastructure/events/event.service';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { QrService } from '@utils/QR/qr.service';
import { PharmacyService } from '@services/pharmacy/services/pharmacy.service';
import { OpsDbService, type OpsActor } from './ops-db.service';
import { ClinicAuditService } from './audit.service';
import { handoverHashesMatch, hashHandoverCode } from './ops-integrity.util';
import { checkHandoverReadiness } from '@services/clinic-ops/services/handover-readiness.util';
import type { PrismaDelegateArgs } from '@core/types/prisma.types';
import {
  displayName,
  sharedDelegates,
  type DispenseHandoverRow,
  type PrescriptionLiteRow,
} from '../clinic-ops.types';
import type { ConfirmHandoverDto, VerifyHandoverDto } from '../dto/clinic-ops.dto';

export const HANDOVER_CODE_TTL_MINUTES = 15;
export const HANDOVER_UNDO_MINUTES = 5;
const MAX_ATTEMPTS = 5;
const UNDO_ROLES = new Set(['CLINIC_ADMIN', 'SUPER_ADMIN']);
/** Socket-broadcast event of every hand-over state change (see EventSocketBroadcaster). */
export const HANDOVER_UPDATED_EVENT = 'pharmacy.handover.updated';
export type HandoverAction = 'CODE_ISSUED' | 'VERIFIED' | 'HANDED_OVER' | 'UNDONE';

export interface HandoverCodeResponse {
  handoverId: string;
  /** Shown once to the patient; only its hash is stored. */
  code: string;
  /** Text to render as a QR in the patient app. */
  qrPayload: string;
  /** PNG data URL of qrPayload (null only if rendering failed) for clients without a QR lib. */
  qrImage: string | null;
  expiresAt: string;
}

export interface HandoverItem {
  prescriptionItemId: string;
  medicineName: string | null;
  dosage: string | null;
  frequency: string | null;
  duration: string | null;
  quantity: number | null;
}

export interface HandoverResponse {
  id: string;
  prescriptionId: string;
  status: string;
  method: string | null;
  verified: boolean;
  verifiedAt: string | null;
  patientName: string;
  items: HandoverItem[];
  itemChecklist: unknown;
  acknowledgedBy: string | null;
  handedOverAt: string | null;
  undoUntil: string | null;
  canUndo: boolean;
  undoneAt: string | null;
}

export { hashHandoverCode, handoverHashesMatch };

/** The QR text the patient app renders: `TBD-HO:<handoverId>:<6-digit code>`. */
export const HANDOVER_QR_PATTERN = /^TBD-HO:([0-9a-fA-F-]{36}):(\d{6})$/;

/** What the desk entered: the bare 6 digits, or the QR text (which also names the hand-over). */
export function parseHandoverInput(raw: string): { code: string; handoverId?: string } {
  const trimmed = raw.trim();
  const fromQr = HANDOVER_QR_PATTERN.exec(trimmed);
  if (fromQr?.[1] && fromQr[2]) {
    return { code: fromQr[2], handoverId: fromQr[1].toLowerCase() };
  }
  return { code: trimmed };
}

/** Accepts the bare 6 digits or the QR text `TBD-HO:<handoverId>:<code>`. */
export function extractHandoverCode(raw: string): string {
  return parseHandoverInput(raw).code;
}

const RX_SELECT = {
  id: true,
  clinicId: true,
  patientId: true,
  doctorId: true,
  status: true,
  patient: {
    select: {
      id: true,
      userId: true,
      user: { select: { name: true, firstName: true, lastName: true } },
    },
  },
  items: {
    select: {
      id: true,
      dosage: true,
      frequency: true,
      duration: true,
      quantity: true,
      medicine: { select: { id: true, name: true } },
    },
  },
};

@Injectable()
export class HandoverService {
  /** HMAC key for the stored code hash (dedicated secret, else the JWT secret). */
  private readonly otpKey: string | undefined;

  constructor(
    private readonly ops: OpsDbService,
    private readonly audit: ClinicAuditService,
    private readonly qr: QrService,
    private readonly pharmacy: PharmacyService,
    private readonly eventService: EventService,
    @Optional() config?: ConfigService,
    @Optional() private readonly loggingService?: LoggingService
  ) {
    this.otpKey =
      config?.getEnv('HANDOVER_OTP_SECRET') || config?.getEnv('JWT_SECRET') || undefined;
  }

  /** PATIENT: issue (or renew) the code for their own prescription. */
  async issueCode(
    prescriptionId: string,
    clinicId: string,
    actor: OpsActor
  ): Promise<HandoverCodeResponse> {
    const rx = await this.loadPrescription(prescriptionId, clinicId);
    if (rx.patient?.userId !== actor.userId) {
      throw new ForbiddenException('This prescription belongs to another patient');
    }
    await this.assertReadyForHandover(prescriptionId, clinicId);
    const open = await this.ops.read(client =>
      client.dispenseHandover.findFirst({
        where: { clinicId, prescriptionId, status: 'PENDING_VERIFICATION' },
        orderBy: { createdAt: 'desc' },
      })
    );
    if (open && open.verifiedAt) {
      throw new BadRequestException('This hand-over is already verified at the counter');
    }
    const code = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + HANDOVER_CODE_TTL_MINUTES * 60_000);
    const row = open
      ? await this.ops.write(
          client =>
            client.dispenseHandover.update({
              where: { id: open.id },
              data: {
                otpHash: hashHandoverCode(open.id, code, this.otpKey),
                otpExpiresAt: expiresAt,
                otpAttempts: 0,
              },
            }),
          {
            actor,
            clinicId,
            resourceType: 'DISPENSE_HANDOVER',
            operation: 'RENEW_CODE',
            resourceId: open.id,
          }
        )
      : await this.createWithCode(prescriptionId, clinicId, rx, code, expiresAt, actor);
    if (!open) await this.bustPrescriptionCache(prescriptionId, clinicId);
    await this.emitHandoverUpdated(rx, row.id, 'PENDING_VERIFICATION', 'CODE_ISSUED');
    const qrPayload = `TBD-HO:${row.id}:${code}`;
    return {
      handoverId: row.id,
      code,
      qrPayload,
      qrImage: await this.renderQr(qrPayload),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** PHARMACIST / CLINIC_ADMIN: check the code the patient shows. */
  async verify(
    prescriptionId: string,
    dto: VerifyHandoverDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<HandoverResponse> {
    const rx = await this.loadPrescription(prescriptionId, clinicId);
    await this.assertReadyForHandover(prescriptionId, clinicId);
    const row = await this.ops.read(client =>
      client.dispenseHandover.findFirst({
        where: { clinicId, prescriptionId, status: 'PENDING_VERIFICATION' },
        orderBy: { createdAt: 'desc' },
      })
    );
    if (!row || !row.otpHash || !row.otpExpiresAt) {
      throw new BadRequestException('The patient has not generated a hand-over code yet');
    }
    const entered = parseHandoverInput(dto.code);
    // A QR names its hand-over: one of another prescription (or an older, renewed code of this
    // one) is refused before an attempt is spent, and its code is never compared.
    if (entered.handoverId && entered.handoverId !== String(row.id).toLowerCase()) {
      throw new BadRequestException(
        'This QR code is not for this prescription - ask the patient to show the current code'
      );
    }
    if (row.otpAttempts >= MAX_ATTEMPTS) {
      throw new BadRequestException(
        'Too many wrong codes - ask the patient to generate a new code'
      );
    }
    if (row.otpExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('The code has expired - ask the patient to generate a new one');
    }
    // Claim one attempt atomically BEFORE comparing, so parallel guesses cannot all slip in
    // under the limit between the read above and the increment.
    const attempt = await this.ops.write(
      client =>
        client.dispenseHandover.updateMany({
          where: {
            id: row.id,
            clinicId,
            status: 'PENDING_VERIFICATION',
            otpAttempts: { lt: MAX_ATTEMPTS },
          },
          data: { otpAttempts: { increment: 1 } },
        }),
      {
        actor,
        clinicId,
        resourceType: 'DISPENSE_HANDOVER',
        operation: 'VERIFY_ATTEMPT',
        resourceId: row.id,
      }
    );
    if (attempt.count === 0) {
      throw new BadRequestException(
        'Too many wrong codes - ask the patient to generate a new code'
      );
    }
    if (!handoverHashesMatch(hashHandoverCode(row.id, entered.code, this.otpKey), row.otpHash)) {
      await this.audit.record(
        clinicId,
        { type: 'DISPENSE_HANDOVER', id: row.id },
        'VERIFY_FAILED',
        actor,
        { prescriptionId }
      );
      throw new BadRequestException('That code does not match');
    }
    // Only the code that was compared may be consumed: a renewed code (new hash) or a parallel
    // verify that already succeeded leaves nothing to claim.
    const claimed = await this.ops.write(
      client =>
        client.dispenseHandover.updateMany({
          where: {
            id: row.id,
            clinicId,
            status: 'PENDING_VERIFICATION',
            otpHash: row.otpHash,
            verifiedAt: null,
          },
          data: {
            verifiedAt: new Date(),
            method: dto.method ?? (entered.handoverId ? 'QR' : 'OTP'),
            otpHash: null,
          },
        }),
      {
        actor,
        clinicId,
        resourceType: 'DISPENSE_HANDOVER',
        operation: 'VERIFY',
        resourceId: row.id,
      }
    );
    if (claimed.count !== 1) {
      throw new BadRequestException('This code was already used or renewed - verify again');
    }
    await this.emitHandoverUpdated(rx, row.id, 'PENDING_VERIFICATION', 'VERIFIED');
    return this.toResponse(await this.loadHandover(row.id, clinicId), rx);
  }

  /** PHARMACIST / CLINIC_ADMIN: tick items, record receiver + signature, hand over. */
  async confirm(
    handoverId: string,
    dto: ConfirmHandoverDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<HandoverResponse> {
    const row = await this.loadHandover(handoverId, clinicId);
    if (row.status !== 'PENDING_VERIFICATION') {
      throw new BadRequestException(`This hand-over is already ${row.status}`);
    }
    if (!row.verifiedAt) {
      throw new BadRequestException('Verify the patient code before handing over');
    }
    const rx = await this.loadPrescription(row.prescriptionId, clinicId);
    // Re-checked at the moment of hand-over: a reverse-dispense or cancellation since the
    // code was verified must stop the medicines leaving the counter.
    await this.assertReadyForHandover(row.prescriptionId, clinicId);
    const valid = new Set((rx.items ?? []).map(i => i.id));
    for (const item of dto.itemChecklist) {
      if (!valid.has(item.prescriptionItemId)) {
        throw new BadRequestException('A checked item does not belong to this prescription');
      }
    }
    if (!dto.itemChecklist.some(i => i.handedOver)) {
      throw new BadRequestException('Tick at least one item that was handed over');
    }
    const now = new Date();
    const undoUntil = new Date(now.getTime() + HANDOVER_UNDO_MINUTES * 60_000);
    const claimed = await this.ops.write(
      client =>
        client.dispenseHandover.updateMany({
          where: { id: handoverId, clinicId, status: 'PENDING_VERIFICATION' },
          data: {
            status: 'HANDED_OVER',
            itemChecklist: dto.itemChecklist,
            acknowledgedBy: dto.acknowledgedBy.trim(),
            signature: dto.signature ?? null,
            handedOverById: actor.userId,
            handedOverAt: now,
            undoUntil,
          },
        }),
      {
        actor,
        clinicId,
        resourceType: 'DISPENSE_HANDOVER',
        operation: 'CONFIRM',
        resourceId: handoverId,
      }
    );
    if (claimed.count !== 1) throw new BadRequestException('This hand-over was already handled');
    await this.audit.record(
      clinicId,
      { type: 'DISPENSE_HANDOVER', id: handoverId },
      'HANDED_OVER',
      actor,
      {
        prescriptionId: row.prescriptionId,
        items: dto.itemChecklist.filter(i => i.handedOver).length,
      }
    );
    await this.bustPrescriptionCache(row.prescriptionId, clinicId);
    await this.emitHandoverUpdated(rx, handoverId, 'HANDED_OVER', 'HANDED_OVER');
    return this.get(handoverId, clinicId);
  }

  /** The pharmacist who handed over (or an admin) undoes it inside the window. */
  async undo(handoverId: string, clinicId: string, actor: OpsActor): Promise<HandoverResponse> {
    const row = await this.loadHandover(handoverId, clinicId);
    if (row.status !== 'HANDED_OVER') {
      throw new BadRequestException('Only a completed hand-over can be undone');
    }
    const isOwner = row.handedOverById === actor.userId;
    if (!isOwner && !UNDO_ROLES.has(actor.role.toUpperCase())) {
      throw new ForbiddenException('Only the person who handed over can undo it');
    }
    if (!row.undoUntil || row.undoUntil.getTime() < Date.now()) {
      throw new BadRequestException('The undo window has closed');
    }
    const undone = await this.ops.write(
      client =>
        client.dispenseHandover.updateMany({
          where: {
            id: handoverId,
            clinicId,
            status: 'HANDED_OVER',
            undoUntil: { gte: new Date() },
          },
          data: { status: 'UNDONE', undoneAt: new Date(), undoneById: actor.userId },
        }),
      {
        actor,
        clinicId,
        resourceType: 'DISPENSE_HANDOVER',
        operation: 'UNDO',
        resourceId: handoverId,
      }
    );
    if (undone.count !== 1) {
      throw new BadRequestException('This hand-over was already undone or the window has closed');
    }
    await this.audit.record(
      clinicId,
      { type: 'DISPENSE_HANDOVER', id: handoverId },
      'UNDONE',
      actor
    );
    await this.bustPrescriptionCache(row.prescriptionId, clinicId);
    const rx = await this.loadPrescription(row.prescriptionId, clinicId);
    await this.emitHandoverUpdated(rx, handoverId, 'UNDONE', 'UNDONE');
    return this.get(handoverId, clinicId);
  }

  async get(handoverId: string, clinicId: string): Promise<HandoverResponse> {
    const row = await this.loadHandover(handoverId, clinicId);
    const rx = await this.loadPrescription(row.prescriptionId, clinicId);
    return this.toResponse(row, rx);
  }

  /** Latest hand-over of a prescription (null when none has started). */
  async latestForPrescription(
    prescriptionId: string,
    clinicId: string
  ): Promise<HandoverResponse | null> {
    const row = await this.ops.read(client =>
      client.dispenseHandover.findFirst({
        where: { clinicId, prescriptionId },
        orderBy: { createdAt: 'desc' },
      })
    );
    if (!row) return null;
    const rx = await this.loadPrescription(prescriptionId, clinicId);
    return this.toResponse(row, rx);
  }

  // ------------------------------------------------------------------ helpers

  /**
   * Ids-only state change for the pharmacist board and the patient's own room. Emitted after the
   * write committed; a failure is logged and never fails the hand-over itself.
   */
  private async emitHandoverUpdated(
    rx: PrescriptionLiteRow,
    handoverId: string,
    status: string,
    action: HandoverAction
  ): Promise<void> {
    try {
      await this.eventService.emit(HANDOVER_UPDATED_EVENT, {
        clinicId: rx.clinicId,
        prescriptionId: rx.id,
        handoverId,
        status,
        action,
        ...(rx.patient?.userId ? { patientUserId: rx.patient.userId } : {}),
      });
    } catch (error) {
      await this.loggingService?.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Hand-over update event could not be emitted',
        'HandoverService',
        {
          prescriptionId: rx.id,
          handoverId,
          action,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /** The code is already issued; a QR render failure only drops the image (logged by QrService). */
  private async renderQr(payload: string): Promise<string | null> {
    try {
      return await this.qr.generateQR(payload);
    } catch {
      return null;
    }
  }

  /** Prescription reads carry the hand-over state; never throws (see PharmacyService). */
  private async bustPrescriptionCache(prescriptionId: string, clinicId: string): Promise<void> {
    await this.pharmacy.invalidatePrescriptionListCache({ prescriptionId, clinicId });
  }

  private async createWithCode(
    prescriptionId: string,
    clinicId: string,
    rx: PrescriptionLiteRow,
    code: string,
    expiresAt: Date,
    actor: OpsActor
  ): Promise<DispenseHandoverRow> {
    const created = await this.ops.write(
      client =>
        client.dispenseHandover.create({
          data: {
            clinicId,
            prescriptionId,
            patientId: rx.patientId,
            otpExpiresAt: expiresAt,
            status: 'PENDING_VERIFICATION',
          },
        }),
      {
        actor,
        clinicId,
        resourceType: 'DISPENSE_HANDOVER',
        operation: 'CREATE',
        resourceId: prescriptionId,
      }
    );
    const withCode = await this.ops.write(
      client =>
        client.dispenseHandover.update({
          where: { id: created.id },
          data: { otpHash: hashHandoverCode(created.id, code, this.otpKey) },
        }),
      {
        actor,
        clinicId,
        resourceType: 'DISPENSE_HANDOVER',
        operation: 'SET_CODE',
        resourceId: created.id,
      }
    );
    // Two issue requests racing past the "open hand-over" check each create a row. Keep only the
    // newest one live (verify always picks the newest) and retire the older unverified rows.
    await this.ops.write(
      client =>
        client.dispenseHandover.updateMany({
          where: {
            clinicId,
            prescriptionId,
            status: 'PENDING_VERIFICATION',
            verifiedAt: null,
            id: { not: created.id },
            createdAt: { lte: created.createdAt },
          },
          data: { status: 'SUPERSEDED', otpHash: null },
        }),
      {
        actor,
        clinicId,
        resourceType: 'DISPENSE_HANDOVER',
        operation: 'SUPERSEDE_STALE',
        resourceId: created.id,
      }
    );
    return withCode;
  }

  /**
   * 409 unless the prescription is approved, paid (or zero-priced) and dispensed — see
   * handover-readiness.util. Payment is read from the COMPLETED payments linked to the
   * prescription (the same source the dispense gate uses) and the PHARMACY invoice.
   */
  private async assertReadyForHandover(prescriptionId: string, clinicId: string): Promise<void> {
    const state = await this.ops.read(async client => {
      const shared = sharedDelegates(client);
      const prescription = (await shared.prescription.findFirst({
        where: { id: prescriptionId, clinicId } as PrismaDelegateArgs,
        select: {
          status: true,
          items: {
            select: {
              quantity: true,
              dispensedQuantity: true,
              medicine: { select: { price: true } },
            },
          },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as unknown as {
        status: string;
        items?: Array<{
          quantity: number | null;
          dispensedQuantity: number | null;
          medicine?: { price: number | null } | null;
        }>;
      } | null;
      if (!prescription) return null;
      const [payments, invoice] = await Promise.all([
        shared.payment.findMany({
          where: {
            clinicId,
            status: 'COMPLETED',
            metadata: { path: ['prescriptionId'], equals: prescriptionId },
          } as PrismaDelegateArgs,
          select: { amount: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs) as unknown as Promise<Array<{ amount: number | null }>>,
        client.invoice.findFirst({
          where: { clinicId, billType: 'PHARMACY', prescriptionId },
          select: { status: true },
        }),
      ]);
      return { prescription, payments, invoice };
    });
    if (!state) throw new NotFoundException('Prescription not found');
    const readiness = checkHandoverReadiness({
      status: state.prescription.status,
      items: (state.prescription.items ?? []).map(item => ({
        quantity: item.quantity,
        dispensedQuantity: item.dispensedQuantity,
        unitPrice: item.medicine?.price ?? 0,
      })),
      paidAmount: state.payments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0),
      invoiceStatus: state.invoice?.status ?? null,
    });
    if (!readiness.ok) throw new ConflictException(readiness.message);
  }

  private async loadPrescription(id: string, clinicId: string): Promise<PrescriptionLiteRow> {
    const rx = await this.ops.read(client =>
      client.prescription.findFirst({ where: { id, clinicId }, select: RX_SELECT })
    );
    if (!rx) throw new NotFoundException('Prescription not found');
    return rx;
  }

  private async loadHandover(id: string, clinicId: string): Promise<DispenseHandoverRow> {
    const row = await this.ops.read(client =>
      client.dispenseHandover.findFirst({ where: { id, clinicId } })
    );
    if (!row) throw new NotFoundException('Hand-over not found');
    return row;
  }

  private toResponse(row: DispenseHandoverRow, rx: PrescriptionLiteRow): HandoverResponse {
    return {
      id: row.id,
      prescriptionId: row.prescriptionId,
      status: row.status,
      method: row.method,
      verified: !!row.verifiedAt,
      verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
      patientName: displayName(rx.patient?.user ?? null),
      items: (rx.items ?? []).map(i => ({
        prescriptionItemId: i.id,
        medicineName: i.medicine?.name ?? null,
        dosage: i.dosage,
        frequency: i.frequency,
        duration: i.duration,
        quantity: i.quantity,
      })),
      itemChecklist: row.itemChecklist ?? null,
      acknowledgedBy: row.acknowledgedBy,
      handedOverAt: row.handedOverAt ? row.handedOverAt.toISOString() : null,
      undoUntil: row.undoUntil ? row.undoUntil.toISOString() : null,
      canUndo:
        row.status === 'HANDED_OVER' && !!row.undoUntil && row.undoUntil.getTime() > Date.now(),
      undoneAt: row.undoneAt ? row.undoneAt.toISOString() : null,
    };
  }
}
