/**
 * Clinic Ops - shared row / client types.
 * @module ClinicOps
 * @description The clinic-admin / assistant-doctor operations tables use plain string FKs and
 * enum-like string columns (see the "Clinic admin / assistant doctor / round-3 operations" block
 * of schema.prisma). The generated delegates are cast to these narrow shapes, following the
 * pattern of the other services in this repo.
 */

import type { PrismaTransactionClientWithDelegates } from '@core/types/prisma.types';
import { endOfIstDay, startOfIstDay } from '@utils/clock.util';
import { formatDateKeyInIST } from '@utils/date-time.util';

export type OpsArgs = Record<string, unknown>;

/** Minimal Prisma delegate surface used by the ops services. */
export interface OpsDelegate<Row> {
  create: (args: OpsArgs) => Promise<Row>;
  findFirst: (args: OpsArgs) => Promise<Row | null>;
  findMany: (args: OpsArgs) => Promise<Row[]>;
  update: (args: OpsArgs) => Promise<Row>;
  updateMany: (args: OpsArgs) => Promise<{ count: number }>;
  count: (args?: OpsArgs) => Promise<number>;
}

export interface LeaveRequestRow {
  id: string;
  clinicId: string;
  locationId: string | null;
  userId: string;
  requesterRole: string;
  kind: string;
  startDate: Date;
  endDate: Date;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
  status: string;
  coverUserId: string | null;
  decidedById: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  impactedAppointmentCount: number;
  patientsNotifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClinicHolidayRow {
  id: string;
  clinicId: string;
  locationId: string | null;
  title: string;
  kind: string;
  startDate: Date;
  endDate: Date;
  notifyPatients: boolean;
  notifiedCount: number;
  messageTemplate: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CheckInAttemptRow {
  id: string;
  clinicId: string;
  locationId: string | null;
  appointmentId: string | null;
  patientId: string | null;
  patientName: string | null;
  actorUserId: string | null;
  actorRole: string | null;
  method: string;
  outcome: string;
  failureReason: string | null;
  failureDetail: string | null;
  tokenLabel: string | null;
  resolution: string | null;
  resolvedById: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  createdAt: Date;
}

export interface StaffInviteRow {
  id: string;
  clinicId: string;
  role: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  locationIds: string[];
  tokenHash: string;
  status: string;
  invitedById: string;
  acceptedById: string | null;
  expiresAt: Date;
  lastSentAt: Date | null;
  resendCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DirectDispenseItemRow {
  id: string;
  directDispenseId: string;
  medicineId: string;
  medicineName: string;
  quantity: number;
  unitPrice: number;
  lineAmount: number;
  batchAllocations: unknown;
}

export interface DirectDispenseRow {
  id: string;
  clinicId: string;
  locationId: string | null;
  patientId: string | null;
  walkInName: string | null;
  walkInPhone: string | null;
  prescriptionId: string | null;
  dispensedByUserId: string;
  dispensedByRole: string;
  note: string | null;
  status: string;
  undoUntil: Date;
  reversedAt: Date | null;
  reversedByUserId: string | null;
  reverseReason: string | null;
  invoiceId: string | null;
  totalAmount: number;
  settledAt: Date | null;
  settledMethod: string | null;
  settledById: string | null;
  createdAt: Date;
  updatedAt: Date;
  items?: DirectDispenseItemRow[];
}

export interface InvoiceReminderRow {
  id: string;
  clinicId: string;
  invoiceId: string;
  channel: string;
  language: string;
  message: string | null;
  status: string;
  scheduledFor: Date | null;
  sentAt: Date | null;
  failureReason: string | null;
  sentById: string;
  createdAt: Date;
}

export interface UserLiteRow {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  role: string;
  isActive?: boolean | null;
  lastLogin?: Date | null;
  createdAt?: Date;
}

export interface PatientLiteRow {
  id: string;
  userId: string;
  user: Omit<UserLiteRow, 'id' | 'role'> | null;
}

export interface AppointmentLiteRow {
  id: string;
  doctorId: string;
  patientId: string;
  clinicId: string;
  locationId: string | null;
  date: Date;
  time: string;
  type: string;
  status: string;
  priority: string | null;
  metadata: unknown;
  checkedInAt: Date | null;
  patient?: PatientLiteRow | null;
  doctor?: { id: string; userId: string } | null;
}

export interface PrescriptionLiteRow {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  status: string;
  diagnosis: string | null;
  date: Date;
  draftedByUserId: string | null;
  draftedByRole: string | null;
  draftSnapshot: unknown;
  prescriptionNumber?: string | null;
  submittedAt: Date | null;
  returnedAt: Date | null;
  returnedByUserId: string | null;
  returnNote: string | null;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  notes?: string | null;
  doctor?: { id: string; userId: string } | null;
  patient?: PatientLiteRow | null;
  items?: Array<{
    id: string;
    medicineId: string | null;
    dosage: string | null;
    frequency: string | null;
    duration: string | null;
    quantity: number | null;
    instructions: string | null;
    medicine?: { id: string; name: string } | null;
  }>;
}

export interface MedicineStockRow {
  id: string;
  name: string;
  type: string | null;
  category: string | null;
  unit: string | null;
  manufacturer: string | null;
  stock: number;
  price: number;
  minStockThreshold: number;
  expiryDate: Date | null;
  isActive: boolean;
}

export interface InvoiceLiteRow {
  id: string;
  invoiceNumber: string;
  userId: string;
  clinicId: string;
  patientId: string | null;
  amount: number;
  tax: number | null;
  discount: number | null;
  totalAmount: number;
  status: string;
  dueDate: Date;
  paidAt: Date | null;
  description: string | null;
  lineItems: unknown;
  billType: string;
  createdAt: Date;
  payments?: Array<{
    id: string;
    amount: number;
    status: string;
    method: string | null;
    createdAt: Date;
    paidAt?: Date | null;
  }>;
}

export interface DispenseHandoverRow {
  id: string;
  clinicId: string;
  prescriptionId: string;
  patientId: string | null;
  method: string | null;
  otpHash: string | null;
  otpExpiresAt: Date | null;
  otpAttempts: number;
  status: string;
  verifiedAt: Date | null;
  acknowledgedBy: string | null;
  signature: string | null;
  itemChecklist: unknown;
  handedOverById: string | null;
  handedOverAt: Date | null;
  undoUntil: Date | null;
  undoneAt: Date | null;
  undoneById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClinicAuditEventRow {
  id: string;
  clinicId: string;
  entityType: string;
  entityId: string;
  action: string;
  actorUserId: string | null;
  actorRole: string | null;
  detail: unknown;
  createdAt: Date;
}

export interface LabBookingRow {
  id: string;
  clinicId: string;
  patientId: string;
  userId: string;
  packageCode: string;
  packageName: string;
  tests: unknown;
  addressLine: string;
  city: string | null;
  zipCode: string | null;
  slotDate: Date;
  slotWindow: string;
  status: string;
  notes: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupportMessageRow {
  id: string;
  threadId: string;
  senderType: string;
  senderId: string | null;
  body: string;
  quickReply: boolean;
  quickReplyType: string | null;
  createdAt: Date;
}

export interface SupportThreadRow {
  id: string;
  clinicId: string | null;
  userId: string;
  subject: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  messages?: SupportMessageRow[];
}

export interface InvestigationOrderRow {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  visitId: string | null;
  appointmentId: string | null;
  tests: unknown;
  urgency: string;
  labDestination: string | null;
  notes: string | null;
  status: string;
  orderedAt: Date;
  updatedAt: Date;
}

export interface DoctorFavouriteRow {
  id: string;
  userId: string;
  clinicId: string | null;
  kind: string;
  itemKey: string;
  label: string;
  payload: unknown;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockBatchRow {
  id: string;
  productId: string;
  clinicId: string;
  lotNumber: string;
  expiryDate: Date;
  quantityOnHand: number;
  quantityReceived: number;
  medicineName: string | null;
  medicine?: { id: string; name: string; unit: string | null; supplierId: string | null } | null;
}

export interface StockMovementRow {
  id: string;
  batchId: string;
  movementType: string;
  quantity: number;
  reason: string | null;
  referenceType: string | null;
  recordedById: string;
  createdAt: Date;
}

/** Generated client narrowed to the delegates the ops services touch. */
export type OpsClient = {
  leaveRequest: OpsDelegate<LeaveRequestRow>;
  clinicHoliday: OpsDelegate<ClinicHolidayRow>;
  checkInAttempt: OpsDelegate<CheckInAttemptRow>;
  staffInvite: OpsDelegate<StaffInviteRow>;
  directDispense: OpsDelegate<DirectDispenseRow>;
  invoiceReminder: OpsDelegate<InvoiceReminderRow>;
  user: OpsDelegate<UserLiteRow>;
  patient: OpsDelegate<PatientLiteRow>;
  doctor: OpsDelegate<{ id: string; userId: string; clinicId?: string | null }>;
  appointment: OpsDelegate<AppointmentLiteRow>;
  prescription: OpsDelegate<PrescriptionLiteRow>;
  medicine: OpsDelegate<MedicineStockRow>;
  invoice: OpsDelegate<InvoiceLiteRow> & {
    aggregate: (args: OpsArgs) => Promise<{
      _sum: { totalAmount: number | null };
      _count: { _all: number };
    }>;
  };
  clinic: OpsDelegate<{
    id: string;
    name: string;
    address: string;
    phone: string;
    settings?: unknown;
  }>;
  directDispenseItem: OpsDelegate<DirectDispenseItemRow>;
  dispenseHandover: OpsDelegate<DispenseHandoverRow>;
  clinicAuditEvent: OpsDelegate<ClinicAuditEventRow>;
  labBooking: OpsDelegate<LabBookingRow>;
  supportThread: OpsDelegate<SupportThreadRow>;
  supportMessage: OpsDelegate<SupportMessageRow>;
  investigationOrder: OpsDelegate<InvestigationOrderRow>;
  doctorFavourite: OpsDelegate<DoctorFavouriteRow> & {
    upsert: (args: OpsArgs) => Promise<DoctorFavouriteRow>;
    deleteMany: (args: OpsArgs) => Promise<{ count: number }>;
  };
  stockMovement: OpsDelegate<StockMovementRow>;
  stockBatch: OpsDelegate<StockBatchRow>;
  checkInLocation: OpsDelegate<{
    id: string;
    clinicId: string;
    locationId: string | null;
    locationName: string;
    qrCode: string;
    qrVersion: number;
    isActive: boolean;
  }>;
  clinicLocation: OpsDelegate<{ id: string; clinicId: string }>;
  supplier: OpsDelegate<{ id: string; clinicId: string }>;
  patientVisit: OpsDelegate<{
    id: string;
    clinicId: string;
    patientId: string;
    appointmentId: string | null;
  }>;
};

export function opsClient(client: unknown): OpsClient {
  return client as OpsClient;
}

/** The same transaction client typed for the shared inventory services. */
export function sharedDelegates(client: OpsClient): PrismaTransactionClientWithDelegates {
  return client as unknown as PrismaTransactionClientWithDelegates;
}

/** Parses `YYYY-MM-DD` (or ISO) into a UTC-midnight Date; null when invalid. */
export function parseDay(value: string | undefined | null): Date | null {
  if (!value) return null;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const date = new Date(day);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `createdAt` filter for the IST calendar days `from`..`to` (inclusive; YYYY-MM-DD or ISO). Event
 * logs (check-in attempts, audit) are timestamps, and the clinic's day is the India day, so the
 * shared IST clock helpers decide the bounds (a 00:30 IST scan belongs to that day, not the
 * previous UTC one). Null when neither bound is valid.
 */
export function istCreatedAtRange(
  from?: string | null,
  to?: string | null
): { gte?: Date; lte?: Date } | null {
  const start = from ? startOfIstDay(from) : null;
  const end = to ? endOfIstDay(to) : null;
  if (!start && !end) return null;
  return { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
}

/** Today's IST calendar day, YYYY-MM-DD. */
export function todayIstKey(): string {
  return formatDateKeyInIST(new Date());
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function displayName(
  user: { name?: string | null; firstName?: string | null; lastName?: string | null } | null
): string {
  if (!user) return 'Unknown';
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return (user.name && user.name.trim()) || full || 'Unknown';
}
