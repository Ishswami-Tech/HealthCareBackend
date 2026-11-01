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
import { loadHandoverReadiness } from './handover-readiness.query';
import {
  classifyHandoverCandidates,
  identityMatches,
  matchHandoverCode,
  primaryVerifiedRow,
} from '@services/clinic-ops/services/handover-code-match.util';
import { type DispenseHandoverRow, type PrescriptionLiteRow } from '../clinic-ops.types';
import {
  HANDOVER_RX_SELECT,
  eventTargetOf,
  parseHandoverInput,
  summaryOfListRow,
  summaryOfLite,
  toHandoverResponse,
  type CollectableListRow,
  type HandoverCodePrescription,
  type HandoverCodeResponse,
  type HandoverEventTarget,
  type HandoverResponse,
} from './handover-contract.util';
export {
  HANDOVER_QR_PATTERN,
  extractHandoverCode,
  hashHandoverCode,
  handoverHashesMatch,
  parseHandoverInput,
  toHandoverResponse,
} from './handover-contract.util';
export type {
  AlsoVerifiedHandover,
  HandoverCodePrescription,
  HandoverCodeResponse,
  HandoverItem,
  HandoverResponse,
} from './handover-contract.util';
import type {
  ConfirmHandoverDto,
  VerifyHandoverDto,
  VerifyHandoverWithoutCodeDto,
} from '../dto/clinic-ops.dto';

export const HANDOVER_CODE_TTL_MINUTES = 15;
export const HANDOVER_UNDO_MINUTES = 5;
const MAX_ATTEMPTS = 5;
/** Most prescriptions one shared collection code covers (newest ready ones first). */
const MAX_SHARED_PRESCRIPTIONS = 10;
/** `method` of a hand-over the desk verified by an identity check instead of a code. */
const MANUAL_METHOD = 'MANUAL';
const UNDO_ROLES = new Set(['CLINIC_ADMIN', 'SUPER_ADMIN']);
/** Socket-broadcast event of every hand-over state change (see EventSocketBroadcaster). */
export const HANDOVER_UPDATED_EVENT = 'pharmacy.handover.updated';
export type HandoverAction = 'CODE_ISSUED' | 'VERIFIED' | 'HANDED_OVER' | 'UNDONE';

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

  /**
   * PATIENT: issue (or renew) the collection code. ONE code covers this prescription and every
   * other prescription of the same patient at this clinic that is ready to collect now, so the
   * desk can enter it on whichever of them it opened (see handover-code-match.util).
   */
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
    const siblings = await this.collectableSiblings(rx, clinicId);
    const code = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + HANDOVER_CODE_TTL_MINUTES * 60_000);
    const row = await this.putCode(rx, prescriptionId, code, expiresAt, actor, true);
    if (!row) throw new BadRequestException('This hand-over is already verified at the counter');
    const covered: HandoverCodePrescription[] = [summaryOfLite(rx)];
    for (const sibling of siblings) {
      const siblingRow = await this.putCode(rx, sibling.prescriptionId, code, expiresAt, actor);
      if (siblingRow) covered.push(sibling);
    }
    const qrPayload = `TBD-HO:${row.id}:${code}`;
    return {
      handoverId: row.id,
      code,
      qrPayload,
      qrImage: await this.renderQr(qrPayload),
      expiresAt: expiresAt.toISOString(),
      prescriptions: covered,
    };
  }

  /**
   * PHARMACIST / CLINIC_ADMIN: check the code the patient shows. The code is compared with every
   * live hand-over code of this patient at the clinic and verifies each one it matches; a wrong
   * code spends one attempt on each of them, a right one never spends any.
   */
  async verify(
    prescriptionId: string,
    dto: VerifyHandoverDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<HandoverResponse> {
    const rx = await this.loadPrescription(prescriptionId, clinicId);
    await this.assertReadyForHandover(prescriptionId, clinicId);
    const open = await this.openRowsOfPatient(rx, clinicId);
    if (!open.some(row => row.otpHash && row.otpExpiresAt)) {
      throw new BadRequestException('The patient has not generated a hand-over code yet');
    }
    const entered = parseHandoverInput(dto.code);
    // A QR names its hand-over: a QR of another patient (or an older, renewed code) is refused
    // before an attempt is spent, and its code is never compared.
    if (
      entered.handoverId &&
      !open.some(row => String(row.id).toLowerCase() === entered.handoverId)
    ) {
      throw new BadRequestException(
        'This QR code is not for this patient or was renewed - ask the patient to show the current code'
      );
    }
    const candidates = classifyHandoverCandidates(open, Date.now(), MAX_ATTEMPTS);
    if (candidates.live.length === 0) {
      throw new BadRequestException(
        candidates.locked.length > 0
          ? 'Too many wrong codes - ask the patient to generate a new code'
          : 'The code has expired - ask the patient to generate a new one'
      );
    }
    // Claim one attempt per live row atomically BEFORE comparing, so parallel guesses cannot all
    // slip in under the limit between the read above and the increment.
    const claimed = await this.claimAttempts(candidates.live, clinicId, actor);
    if (claimed.length === 0) {
      throw new BadRequestException(
        'Too many wrong codes - ask the patient to generate a new code'
      );
    }
    const matched = matchHandoverCode(
      claimed,
      entered.code,
      (id, value) => hashHandoverCode(id, value, this.otpKey),
      handoverHashesMatch
    );
    if (matched.length === 0) {
      await this.audit.record(
        clinicId,
        { type: 'DISPENSE_HANDOVER', id: claimed[0]?.id ?? prescriptionId },
        'VERIFY_FAILED',
        actor,
        { prescriptionId, handoverIds: claimed.map(row => row.id) }
      );
      throw new BadRequestException('That code does not match');
    }
    // The right code costs nothing: give back the attempts claimed above.
    await this.refundAttempts(claimed, clinicId, actor);
    const method = dto.method ?? (entered.handoverId ? 'QR' : 'OTP');
    const verified = await this.claimVerified(matched, prescriptionId, clinicId, method, actor);
    const primary = primaryVerifiedRow(verified, prescriptionId);
    if (!primary) {
      throw new BadRequestException('This code was already used or renewed - verify again');
    }
    return this.verifiedResponse(primary, verified, clinicId);
  }

  /**
   * PHARMACIST / CLINIC_ADMIN: the patient has no app or phone with them. The desk confirms the
   * patient by the last 4 digits of the phone on file or the clinic UHID and gives a reason;
   * who / when / why is audited. Paid + dispensed stays a hard guard (assertReadyForHandover).
   */
  async verifyWithoutCode(
    prescriptionId: string,
    dto: VerifyHandoverWithoutCodeDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<HandoverResponse> {
    const rx = await this.loadPrescription(prescriptionId, clinicId);
    await this.assertReadyForHandover(prescriptionId, clinicId);
    const record = await this.identityRecord(rx, clinicId);
    if (!identityMatches(dto.identityCheck, dto.identityValue, record)) {
      await this.audit.record(
        clinicId,
        { type: 'PRESCRIPTION', id: prescriptionId },
        'VERIFY_WITHOUT_CODE_FAILED',
        actor,
        { identityCheck: dto.identityCheck, reason: dto.reason }
      );
      throw new BadRequestException(
        dto.identityCheck === 'PHONE_LAST4'
          ? "Those digits do not match the patient's phone number"
          : "That UHID does not match the patient's record"
      );
    }
    const open = await this.ops.read(client =>
      client.dispenseHandover.findFirst({
        where: { clinicId, prescriptionId, status: 'PENDING_VERIFICATION' },
        orderBy: { createdAt: 'desc' },
      })
    );
    if (open?.verifiedAt) return toHandoverResponse(open, rx);
    const rowId = open ? open.id : (await this.createOpenRow(rx, prescriptionId, actor)).id;
    const claimed = await this.ops.write(
      client =>
        client.dispenseHandover.updateMany({
          where: { id: rowId, clinicId, status: 'PENDING_VERIFICATION', verifiedAt: null },
          data: { verifiedAt: new Date(), method: MANUAL_METHOD, otpHash: null },
        }),
      {
        actor,
        clinicId,
        resourceType: 'DISPENSE_HANDOVER',
        operation: 'VERIFY_WITHOUT_CODE',
        resourceId: rowId,
      }
    );
    if (claimed.count !== 1) {
      throw new BadRequestException('This hand-over was already verified - reload the page');
    }
    await this.audit.record(
      clinicId,
      { type: 'DISPENSE_HANDOVER', id: rowId },
      'VERIFIED_WITHOUT_CODE',
      actor,
      { prescriptionId, identityCheck: dto.identityCheck, reason: dto.reason }
    );
    await this.emitHandoverUpdated(eventTargetOf(rx), rowId, 'PENDING_VERIFICATION', 'VERIFIED');
    return toHandoverResponse(await this.loadHandover(rowId, clinicId), rx);
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
    await this.emitHandoverUpdated(eventTargetOf(rx), handoverId, 'HANDED_OVER', 'HANDED_OVER');
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
    await this.emitHandoverUpdated(eventTargetOf(rx), handoverId, 'UNDONE', 'UNDONE');
    return this.get(handoverId, clinicId);
  }

  async get(handoverId: string, clinicId: string): Promise<HandoverResponse> {
    const row = await this.loadHandover(handoverId, clinicId);
    const rx = await this.loadPrescription(row.prescriptionId, clinicId);
    return toHandoverResponse(row, rx);
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
    return toHandoverResponse(row, rx);
  }

  // ------------------------------------------------------------------ helpers

  /**
   * Ids-only state change for the pharmacist board and the patient's own room. Emitted after the
   * write committed; a failure is logged and never fails the hand-over itself.
   */
  private async emitHandoverUpdated(
    target: HandoverEventTarget,
    handoverId: string,
    status: string,
    action: HandoverAction
  ): Promise<void> {
    try {
      await this.eventService.emit(HANDOVER_UPDATED_EVENT, {
        clinicId: target.clinicId,
        prescriptionId: target.prescriptionId,
        handoverId,
        status,
        action,
        ...(target.patientUserId ? { patientUserId: target.patientUserId } : {}),
      });
    } catch (error) {
      await this.loggingService?.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Hand-over update event could not be emitted',
        'HandoverService',
        {
          prescriptionId: target.prescriptionId,
          handoverId,
          action,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * The patient's OTHER prescriptions at this clinic the counter would hand over now (the
   * server's `canCollect`: approved, paid, dispensed, not collected). Best-effort: a failure only
   * means the code covers the requested prescription alone.
   */
  private async collectableSiblings(
    rx: PrescriptionLiteRow,
    clinicId: string
  ): Promise<HandoverCodePrescription[]> {
    const userId = rx.patient?.userId;
    if (!userId) return [];
    try {
      const rows = (await this.pharmacy.findPrescriptionsByPatient(userId, {
        role: 'PATIENT',
      })) as unknown as CollectableListRow[];
      return rows
        .filter(row => row.id && row.id !== rx.id && row.clinicId === clinicId && row.canCollect)
        .slice(0, MAX_SHARED_PRESCRIPTIONS - 1)
        .map(summaryOfListRow);
    } catch (error) {
      await this.loggingService?.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Could not list the other ready prescriptions for a shared collection code',
        'HandoverService',
        {
          prescriptionId: rx.id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return [];
    }
  }

  /**
   * Stores the code (hash keyed by the row id) on the open hand-over of one prescription, renewing
   * it or creating the row. A row the desk already verified is left alone: `strict` (the
   * prescription the patient asked for) refuses, a sibling is skipped (null).
   */
  private async putCode(
    rx: PrescriptionLiteRow,
    prescriptionId: string,
    code: string,
    expiresAt: Date,
    actor: OpsActor,
    strict = false
  ): Promise<DispenseHandoverRow | null> {
    const clinicId = rx.clinicId;
    const open = await this.ops.read(client =>
      client.dispenseHandover.findFirst({
        where: { clinicId, prescriptionId, status: 'PENDING_VERIFICATION' },
        orderBy: { createdAt: 'desc' },
      })
    );
    if (open?.verifiedAt) {
      if (strict) {
        throw new BadRequestException('This hand-over is already verified at the counter');
      }
      return null;
    }
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
      : await this.createWithCode(prescriptionId, rx, code, expiresAt, actor);
    if (!open) await this.bustPrescriptionCache(prescriptionId, clinicId);
    await this.emitHandoverUpdated(
      { clinicId, prescriptionId, patientUserId: rx.patient?.userId ?? null },
      row.id,
      'PENDING_VERIFICATION',
      'CODE_ISSUED'
    );
    return row;
  }

  /** Unverified hand-overs of the patient at this clinic (plus any of this prescription). */
  private async openRowsOfPatient(
    rx: PrescriptionLiteRow,
    clinicId: string
  ): Promise<DispenseHandoverRow[]> {
    return await this.ops.read(client =>
      client.dispenseHandover.findMany({
        where: {
          clinicId,
          status: 'PENDING_VERIFICATION',
          verifiedAt: null,
          OR: [{ patientId: rx.patientId }, { prescriptionId: rx.id }],
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_SHARED_PRESCRIPTIONS * 2,
      })
    );
  }

  /** One attempt per row, claimed atomically under the limit; returns the rows it was claimed on. */
  private async claimAttempts(
    rows: readonly DispenseHandoverRow[],
    clinicId: string,
    actor: OpsActor
  ): Promise<DispenseHandoverRow[]> {
    const claimed: DispenseHandoverRow[] = [];
    for (const row of rows) {
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
      if (attempt.count === 1) claimed.push(row);
    }
    return claimed;
  }

  /** A matching code gives back the attempts claimed for the comparison. */
  private async refundAttempts(
    rows: readonly DispenseHandoverRow[],
    clinicId: string,
    actor: OpsActor
  ): Promise<void> {
    for (const row of rows) {
      await this.ops.write(
        client =>
          client.dispenseHandover.updateMany({
            where: { id: row.id, clinicId, otpAttempts: { gt: 0 } },
            data: { otpAttempts: { decrement: 1 } },
          }),
        {
          actor,
          clinicId,
          resourceType: 'DISPENSE_HANDOVER',
          operation: 'VERIFY_ATTEMPT_REFUND',
          resourceId: row.id,
        }
      );
    }
  }

  /**
   * Consumes the compared code on every matched row whose prescription is still ready (a
   * reverse-dispense since the code was issued keeps that one at the counter). Only the code that
   * was compared may be consumed: a renewed code (new hash) or a parallel verify claims nothing.
   */
  private async claimVerified(
    matched: readonly DispenseHandoverRow[],
    requestedPrescriptionId: string,
    clinicId: string,
    method: string,
    actor: OpsActor
  ): Promise<DispenseHandoverRow[]> {
    const verified: DispenseHandoverRow[] = [];
    for (const row of matched) {
      if (row.prescriptionId !== requestedPrescriptionId) {
        const ready = await this.assertReadyForHandover(row.prescriptionId, clinicId).then(
          () => true,
          () => false
        );
        if (!ready) continue;
      }
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
            data: { verifiedAt: new Date(), method, otpHash: null },
          }),
        {
          actor,
          clinicId,
          resourceType: 'DISPENSE_HANDOVER',
          operation: 'VERIFY',
          resourceId: row.id,
        }
      );
      if (claimed.count === 1) verified.push(row);
    }
    return verified;
  }

  /** Response of the primary verified hand-over, listing the others the same code verified. */
  private async verifiedResponse(
    primary: DispenseHandoverRow,
    verified: readonly DispenseHandoverRow[],
    clinicId: string
  ): Promise<HandoverResponse> {
    const primaryRx = await this.loadPrescription(primary.prescriptionId, clinicId);
    for (const row of verified) {
      await this.emitHandoverUpdated(
        {
          clinicId,
          prescriptionId: row.prescriptionId,
          patientUserId: primaryRx.patient?.userId ?? null,
        },
        row.id,
        'PENDING_VERIFICATION',
        'VERIFIED'
      );
    }
    return {
      ...toHandoverResponse(await this.loadHandover(primary.id, clinicId), primaryRx),
      alsoVerified: verified
        .filter(row => row.id !== primary.id)
        .map(row => ({ handoverId: row.id, prescriptionId: row.prescriptionId })),
    };
  }

  /** Phone on file and the clinic UHID(s) of the prescription's patient. */
  private async identityRecord(
    rx: PrescriptionLiteRow,
    clinicId: string
  ): Promise<{ phone: string | null; uhids: string[] }> {
    return await this.ops.read(async client => {
      const [patient, identifiers] = await Promise.all([
        client.patient.findFirst({
          where: { id: rx.patientId },
          select: { id: true, userId: true, user: { select: { phone: true } } },
        }),
        client.patientIdentifier.findMany({
          where: { patientId: rx.patientId, clinicId, system: 'UHID' },
          select: { value: true },
        }),
      ]);
      return {
        phone: patient?.user?.phone ?? null,
        uhids: identifiers.map(row => row.value).filter(Boolean),
      };
    });
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

  /** A new open (unverified, code-less) hand-over row of a prescription. */
  private async createOpenRow(
    rx: PrescriptionLiteRow,
    prescriptionId: string,
    actor: OpsActor,
    otpExpiresAt: Date | null = null
  ): Promise<DispenseHandoverRow> {
    const created = await this.ops.write(
      client =>
        client.dispenseHandover.create({
          data: {
            clinicId: rx.clinicId,
            prescriptionId,
            patientId: rx.patientId,
            otpExpiresAt,
            status: 'PENDING_VERIFICATION',
          },
        }),
      {
        actor,
        clinicId: rx.clinicId,
        resourceType: 'DISPENSE_HANDOVER',
        operation: 'CREATE',
        resourceId: prescriptionId,
      }
    );
    if (!otpExpiresAt) await this.bustPrescriptionCache(prescriptionId, rx.clinicId);
    return created;
  }

  private async createWithCode(
    prescriptionId: string,
    rx: PrescriptionLiteRow,
    code: string,
    expiresAt: Date,
    actor: OpsActor
  ): Promise<DispenseHandoverRow> {
    const clinicId = rx.clinicId;
    const created = await this.createOpenRow(rx, prescriptionId, actor, expiresAt);
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

  /** 409 unless approved, paid (or zero-priced) and dispensed (see handover-readiness.query). */
  private async assertReadyForHandover(prescriptionId: string, clinicId: string): Promise<void> {
    const readiness = await loadHandoverReadiness(this.ops, prescriptionId, clinicId);
    if (!readiness) throw new NotFoundException('Prescription not found');
    if (!readiness.ok) throw new ConflictException(readiness.message);
  }

  private async loadPrescription(id: string, clinicId: string): Promise<PrescriptionLiteRow> {
    const rx = await this.ops.read(client =>
      client.prescription.findFirst({ where: { id, clinicId }, select: HANDOVER_RX_SELECT })
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
}
