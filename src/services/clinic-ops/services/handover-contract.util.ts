/**
 * Hand-over contract (pure): response shapes, the QR text format, the prescription select the
 * hand-over reads and the row -> response mapper. Split from HandoverService to keep it focused.
 */

import { hashHandoverCode, handoverHashesMatch } from './ops-integrity.util';
import {
  displayName,
  type DispenseHandoverRow,
  type PrescriptionLiteRow,
} from '../clinic-ops.types';

/** A prescription a collection code covers, so the patient sees which medicines it collects. */
export interface HandoverCodePrescription {
  prescriptionId: string;
  prescriptionNumber: string | null;
  prescribedAt: string | null;
  medicines: string[];
}

export interface HandoverCodeResponse {
  handoverId: string;
  /** Shown once to the patient; only its hash is stored. */
  code: string;
  /** Text to render as a QR in the patient app. */
  qrPayload: string;
  /** PNG data URL of qrPayload (null only if rendering failed) for clients without a QR lib. */
  qrImage: string | null;
  expiresAt: string;
  /** Every prescription this one code collects (the requested one first). */
  prescriptions: HandoverCodePrescription[];
}

/** Another prescription of the same patient the same code verified. */
export interface AlsoVerifiedHandover {
  handoverId: string;
  prescriptionId: string;
}

/** Who a hand-over socket event is about (ids only). */
export interface HandoverEventTarget {
  clinicId: string;
  prescriptionId: string;
  patientUserId: string | null;
}

/** A row of PharmacyService.findPrescriptionsByPatient, as far as the hand-over reads it. */
export interface CollectableListRow {
  id?: string;
  clinicId?: string;
  canCollect?: boolean;
  prescriptionNumber?: string | null;
  date?: Date | string | null;
  items?: Array<{ medicine?: { name?: string | null } | null } | null> | null;
}

const isoOrNull = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

export function summaryOfLite(rx: PrescriptionLiteRow): HandoverCodePrescription {
  return {
    prescriptionId: rx.id,
    prescriptionNumber: rx.prescriptionNumber ?? null,
    prescribedAt: isoOrNull(rx.date),
    medicines: (rx.items ?? []).map(item => item.medicine?.name ?? 'Medicine'),
  };
}

export function summaryOfListRow(row: CollectableListRow): HandoverCodePrescription {
  return {
    prescriptionId: String(row.id),
    prescriptionNumber: row.prescriptionNumber ?? null,
    prescribedAt: isoOrNull(row.date),
    medicines: (row.items ?? []).map(item => item?.medicine?.name ?? 'Medicine'),
  };
}

export function eventTargetOf(rx: PrescriptionLiteRow): HandoverEventTarget {
  return {
    clinicId: rx.clinicId,
    prescriptionId: rx.id,
    patientUserId: rx.patient?.userId ?? null,
  };
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
  /** Verify only: other prescriptions of the same patient the same code verified. */
  alsoVerified?: AlsoVerifiedHandover[];
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

export const HANDOVER_RX_SELECT = {
  id: true,
  clinicId: true,
  patientId: true,
  doctorId: true,
  status: true,
  date: true,
  prescriptionNumber: true,
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

export function toHandoverResponse(
  row: DispenseHandoverRow,
  rx: PrescriptionLiteRow
): HandoverResponse {
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
