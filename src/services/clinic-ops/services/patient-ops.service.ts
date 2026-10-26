/**
 * Patient Ops Service
 * @module ClinicOps
 * @description Patient-app features that have no home elsewhere: home lab booking (round 3) and
 * the help chat. Staff can see and answer both from the front desk / clinic admin.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  QR_WINDOW_CLOSES_AFTER_MINUTES,
  QR_WINDOW_OPENS_BEFORE_MINUTES,
} from '@utils/in-person-flow.util';
import { EventService } from '@infrastructure/events/event.service';
import { OpsDbService, type OpsActor } from './ops-db.service';
import { resolvePackageTests } from './ops-integrity.util';
import {
  compareByLastMessageDesc,
  summarizeSupportThread,
} from '@services/clinic-ops/services/support-thread-summary.util';
import { displayName, parseDay, startOfUtcDay, type LabBookingRow } from '../clinic-ops.types';
import type {
  CreateLabBookingDto,
  SendSupportMessageDto,
  StaffSupportReplyDto,
  UpdateLabBookingStatusDto,
} from '../dto/clinic-ops.dto';

export const LAB_PACKAGES = [
  {
    code: 'FULL_BODY_BASIC',
    name: 'Full body checkup - basic',
    tests: [
      'CBC',
      'Blood sugar (fasting)',
      'Lipid profile',
      'Liver function',
      'Kidney function',
      'Urine routine',
    ],
  },
  {
    code: 'FULL_BODY_ADVANCED',
    name: 'Full body checkup - advanced',
    tests: [
      'CBC',
      'HbA1c',
      'Lipid profile',
      'Liver function',
      'Kidney function',
      'Thyroid profile',
      'Vitamin D',
      'Vitamin B12',
      'Urine routine',
    ],
  },
  {
    code: 'DIABETES',
    name: 'Diabetes care',
    tests: ['HbA1c', 'Blood sugar (fasting)', 'Blood sugar (PP)', 'Urine microalbumin'],
  },
  { code: 'THYROID', name: 'Thyroid profile', tests: ['TSH', 'T3', 'T4'] },
  {
    code: 'FEVER_PANEL',
    name: 'Fever panel',
    tests: ['CBC', 'Malaria antigen', 'Dengue NS1', 'Typhoid'],
  },
] as const;

export const LAB_SLOT_WINDOWS = [
  '07:00-09:00',
  '09:00-11:00',
  '11:00-13:00',
  '16:00-18:00',
] as const;

export interface LabBookingResponse {
  id: string;
  packageCode: string;
  packageName: string;
  tests: string[];
  addressLine: string;
  city: string | null;
  zipCode: string | null;
  slotDate: string;
  slotWindow: string;
  status: string;
  notes: string | null;
  patientName?: string;
  createdAt: string;
}

export interface SupportMessageResponse {
  id: string;
  senderType: string;
  body: string;
  /** Kept for older clients; true when quickReplyType is set. */
  quickReply: boolean;
  /** The chip that was tapped (RESCHEDULE | CHECK_IN_HELP | ...), null for typed messages. */
  quickReplyType: string | null;
  at: string;
}

export interface SupportThreadResponse {
  id: string;
  status: string;
  subject: string | null;
  patientName?: string;
  lastMessageAt: string | null;
  messages: SupportMessageResponse[];
  /** Staff inbox only: patient messages since the last staff reply. */
  unreadCount?: number;
  unread?: boolean;
  needsReply?: boolean;
}

/** Newest messages read per thread for the inbox flags. */
const INBOX_MESSAGE_WINDOW = 30;

const CANNED_REPLIES: Record<string, string> = {
  RESCHEDULE:
    'You can reschedule an in-clinic or video visit yourself before check-in: open Appointments, tap the visit, then Reschedule (up to 2 times per visit). Already checked in at the clinic? Ask the reception desk to move it. Doctors do not cancel visits; to cancel, use Cancel on the same screen or ask reception.',
  CHECK_IN_HELP: `Scan the QR poster at the clinic reception. Check-in opens ${QR_WINDOW_OPENS_BEFORE_MINUTES} minutes before your appointment time and closes ${QR_WINDOW_CLOSES_AFTER_MINUTES} minutes after it. After that, or if the scan fails, the front desk can check you in manually.`,
  REPORTS:
    'Your reports are under Reports. You can also upload an outside report and share it with your doctor.',
  BILLING:
    'Invoices and receipts are under Payments. For a billing question, a staff member will reply here shortly.',
  PRESCRIPTION:
    'Your prescriptions are under Prescriptions. Show the pickup code at the pharmacy counter to collect medicines.',
  TALK_TO_STAFF: 'A staff member from the clinic has been notified and will reply here shortly.',
};
const GENERIC_REPLY =
  'Thanks for writing. Our care team has been notified and will reply here shortly.';

@Injectable()
export class PatientOpsService {
  constructor(
    private readonly ops: OpsDbService,
    private readonly eventService: EventService
  ) {}

  // ------------------------------------------------------------------ lab booking

  packages(): { packages: typeof LAB_PACKAGES; slotWindows: typeof LAB_SLOT_WINDOWS } {
    return { packages: LAB_PACKAGES, slotWindows: LAB_SLOT_WINDOWS };
  }

  async createLabBooking(
    dto: CreateLabBookingDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<LabBookingResponse> {
    const patient = await this.patientOf(actor.userId);
    const pkg = LAB_PACKAGES.find(p => p.code === dto.packageCode);
    if (!pkg) throw new BadRequestException('Unknown package');
    if (!(LAB_SLOT_WINDOWS as readonly string[]).includes(dto.slotWindow)) {
      throw new BadRequestException(`slotWindow must be one of ${LAB_SLOT_WINDOWS.join(', ')}`);
    }
    const day = parseDay(dto.slotDate);
    if (!day || day.getTime() < startOfUtcDay(new Date()).getTime()) {
      throw new BadRequestException('Choose a slot date that is today or later');
    }
    const tests = resolvePackageTests(pkg.tests, dto.tests);
    const row = await this.ops.write(
      client =>
        client.labBooking.create({
          data: {
            clinicId,
            patientId: patient.id,
            userId: actor.userId,
            packageCode: pkg.code,
            packageName: pkg.name,
            tests,
            addressLine: dto.addressLine.trim(),
            city: dto.city ?? null,
            zipCode: dto.zipCode ?? null,
            slotDate: day,
            slotWindow: dto.slotWindow,
            status: 'REQUESTED',
            notes: dto.notes ?? null,
          },
        }),
      { actor, clinicId, resourceType: 'LAB_BOOKING', operation: 'CREATE' }
    );
    return this.toLab(row);
  }

  async myLabBookings(clinicId: string, actor: OpsActor): Promise<LabBookingResponse[]> {
    const rows = await this.ops.read(client =>
      client.labBooking.findMany({
        where: { clinicId, userId: actor.userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    );
    return rows.map(r => this.toLab(r));
  }

  async cancelLabBooking(
    id: string,
    clinicId: string,
    actor: OpsActor
  ): Promise<LabBookingResponse> {
    const row = await this.ops.read(client =>
      client.labBooking.findFirst({ where: { id, clinicId, userId: actor.userId } })
    );
    if (!row) throw new NotFoundException('Booking not found');
    if (!['REQUESTED', 'CONFIRMED'].includes(row.status)) {
      throw new BadRequestException(`A ${row.status.toLowerCase()} booking cannot be cancelled`);
    }
    const updated = await this.ops.write(
      client =>
        client.labBooking.update({
          where: { id },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        }),
      { actor, clinicId, resourceType: 'LAB_BOOKING', operation: 'CANCEL', resourceId: id }
    );
    return this.toLab(updated);
  }

  async listLabBookings(clinicId: string, status?: string): Promise<LabBookingResponse[]> {
    const rows = await this.ops.read(client =>
      client.labBooking.findMany({
        where: { clinicId, ...(status ? { status: status.toUpperCase() } : {}) },
        orderBy: { slotDate: 'asc' },
        take: 200,
      })
    );
    const names = await this.patientNames(rows.map(r => r.patientId));
    return rows.map(r => ({ ...this.toLab(r), patientName: names.get(r.patientId) ?? 'Unknown' }));
  }

  async setLabBookingStatus(
    id: string,
    dto: UpdateLabBookingStatusDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<LabBookingResponse> {
    const row = await this.ops.read(client =>
      client.labBooking.findFirst({ where: { id, clinicId } })
    );
    if (!row) throw new NotFoundException('Booking not found');
    if (['COMPLETED', 'CANCELLED'].includes(row.status)) {
      throw new BadRequestException(`This booking is already ${row.status.toLowerCase()}`);
    }
    const updated = await this.ops.write(
      client =>
        client.labBooking.update({
          where: { id },
          data: {
            status: dto.status,
            ...(dto.status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
          },
        }),
      { actor, clinicId, resourceType: 'LAB_BOOKING', operation: 'SET_STATUS', resourceId: id }
    );
    // Staff-driven transition the patient has no other way to learn about (they only ever pull-to-
    // refresh app/lab-booking.tsx otherwise) — unlike create/cancel, which the patient themselves
    // just did and already saw confirmed in the app.
    await this.eventService.emit('clinic-ops.lab-booking.status-changed', {
      userId: row.userId,
      clinicId,
      bookingId: id,
      packageName: row.packageName,
      status: dto.status,
    });
    return this.toLab(updated);
  }

  // ------------------------------------------------------------------ help chat

  /** The patient's open thread (created on first use) with its messages. */
  async myThread(clinicId: string, actor: OpsActor): Promise<SupportThreadResponse> {
    const thread = await this.openThread(clinicId, actor);
    return this.loadThread(thread.id, actor.userId);
  }

  async sendMessage(
    dto: SendSupportMessageDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<SupportThreadResponse> {
    const thread = await this.openThread(clinicId, actor);
    const reply = (dto.quickReply && CANNED_REPLIES[dto.quickReply]) || GENERIC_REPLY;
    await this.ops.write(
      async client => {
        await client.supportMessage.create({
          data: {
            threadId: thread.id,
            senderType: 'PATIENT',
            senderId: actor.userId,
            body: dto.body.trim(),
            quickReply: !!dto.quickReply,
            quickReplyType: dto.quickReply ?? null,
          },
        });
        await client.supportMessage.create({
          data: { threadId: thread.id, senderType: 'ASSISTANT', body: reply, quickReply: false },
        });
        await client.supportThread.update({
          where: { id: thread.id },
          data: { updatedAt: new Date() },
        });
      },
      {
        actor,
        clinicId,
        resourceType: 'SUPPORT_THREAD',
        operation: 'MESSAGE',
        resourceId: thread.id,
      }
    );
    return this.loadThread(thread.id, actor.userId);
  }

  async listThreads(clinicId: string): Promise<SupportThreadResponse[]> {
    const threads = await this.ops.read(client =>
      client.supportThread.findMany({
        // Strict clinic match: a thread without a clinic is nobody's queue, and matching it
        // would show one clinic's staff another clinic's patient conversation.
        where: { clinicId, status: 'OPEN' },
        orderBy: { updatedAt: 'desc' },
        take: 100,
        include: { messages: { orderBy: { createdAt: 'desc' }, take: INBOX_MESSAGE_WINDOW } },
      })
    );
    const users = await this.ops.read(client =>
      client.user.findMany({
        where: { id: { in: threads.map(t => t.userId) } },
        select: { id: true, name: true, firstName: true, lastName: true },
      })
    );
    const names = new Map(users.map(u => [u.id, displayName(u)]));
    return threads
      .map(t => ({ thread: t, ...summarizeSupportThread(t.messages ?? [], t.updatedAt) }))
      .sort(compareByLastMessageDesc)
      .map(({ thread: t, lastMessageAt, unreadCount, unread, needsReply }) => ({
        id: t.id,
        status: t.status,
        subject: t.subject,
        patientName: names.get(t.userId) ?? 'Unknown',
        lastMessageAt: lastMessageAt ? lastMessageAt.toISOString() : null,
        // Latest message only (inbox preview); open the thread for the full conversation.
        messages: (t.messages ?? []).slice(0, 1).map(m => this.toMessage(m)),
        unreadCount,
        unread,
        needsReply,
      }));
  }

  /**
   * Staff: one thread with its full history (oldest first). Strictly clinic-scoped: a thread of
   * another clinic (or one without a clinic) is a 404, never a 403 that would confirm it exists.
   */
  async staffThread(threadId: string, clinicId: string): Promise<SupportThreadResponse> {
    const thread = await this.ops.read(client =>
      client.supportThread.findFirst({ where: { id: threadId, clinicId } })
    );
    if (!thread) throw new NotFoundException('Conversation not found');
    const [full, users] = await Promise.all([
      this.loadThread(thread.id, thread.userId),
      this.ops.read(client =>
        client.user.findMany({
          where: { id: { in: [thread.userId] } },
          select: { id: true, name: true, firstName: true, lastName: true },
        })
      ),
    ]);
    const summary = summarizeSupportThread(
      full.messages.map(m => ({ senderType: m.senderType, createdAt: new Date(m.at) })),
      thread.updatedAt
    );
    return {
      ...full,
      patientName: users[0] ? displayName(users[0]) : 'Unknown',
      unreadCount: summary.unreadCount,
      unread: summary.unread,
      needsReply: summary.needsReply,
    };
  }

  async staffReply(
    threadId: string,
    dto: StaffSupportReplyDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<SupportThreadResponse> {
    const thread = await this.ops.read(client =>
      client.supportThread.findFirst({
        where: { id: threadId, clinicId },
      })
    );
    if (!thread) throw new NotFoundException('Conversation not found');
    await this.ops.write(
      async client => {
        await client.supportMessage.create({
          data: {
            threadId,
            senderType: 'STAFF',
            senderId: actor.userId,
            body: dto.body.trim(),
            quickReply: false,
          },
        });
        await client.supportThread.update({
          where: { id: threadId },
          data: { updatedAt: new Date() },
        });
      },
      {
        actor,
        clinicId,
        resourceType: 'SUPPORT_THREAD',
        operation: 'STAFF_REPLY',
        resourceId: threadId,
      }
    );
    return this.loadThread(threadId, thread.userId);
  }

  // ------------------------------------------------------------------ helpers

  private async patientOf(userId: string): Promise<{ id: string }> {
    const patient = await this.ops.read(client => client.patient.findFirst({ where: { userId } }));
    if (!patient) throw new ForbiddenException('No patient profile for this account');
    return patient;
  }

  private async patientNames(patientIds: string[]): Promise<Map<string, string>> {
    if (!patientIds.length) return new Map();
    const patients = await this.ops.read(client =>
      client.patient.findMany({
        where: { id: { in: [...new Set(patientIds)] } },
        select: { id: true, user: { select: { name: true, firstName: true, lastName: true } } },
      })
    );
    return new Map(patients.map(p => [p.id, displayName(p.user)]));
  }

  private async openThread(clinicId: string, actor: OpsActor): Promise<{ id: string }> {
    const existing = await this.ops.read(client =>
      client.supportThread.findFirst({
        // Scoped to the clinic: a patient of two clinics has one open thread per clinic.
        where: { userId: actor.userId, clinicId, status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
      })
    );
    if (existing) return existing;
    return this.ops.write(
      client =>
        client.supportThread.create({
          data: { clinicId, userId: actor.userId, subject: 'Help', status: 'OPEN' },
        }),
      { actor, clinicId, resourceType: 'SUPPORT_THREAD', operation: 'CREATE' }
    );
  }

  private async loadThread(threadId: string, ownerUserId: string): Promise<SupportThreadResponse> {
    const thread = await this.ops.read(client =>
      client.supportThread.findFirst({
        where: { id: threadId, userId: ownerUserId },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 300 } },
      })
    );
    if (!thread) throw new NotFoundException('Conversation not found');
    const messages = (thread.messages ?? []).map(m => this.toMessage(m));
    return {
      id: thread.id,
      status: thread.status,
      subject: thread.subject,
      lastMessageAt: messages.length
        ? (messages[messages.length - 1] as SupportMessageResponse).at
        : null,
      messages,
    };
  }

  private toMessage(m: {
    id: string;
    senderType: string;
    body: string;
    quickReply: boolean;
    quickReplyType?: string | null;
    createdAt: Date;
  }): SupportMessageResponse {
    return {
      id: m.id,
      senderType: m.senderType,
      body: m.body,
      quickReply: m.quickReply,
      quickReplyType: m.quickReplyType ?? null,
      at: m.createdAt.toISOString(),
    };
  }

  private toLab(row: LabBookingRow): LabBookingResponse {
    return {
      id: row.id,
      packageCode: row.packageCode,
      packageName: row.packageName,
      tests: Array.isArray(row.tests) ? (row.tests as string[]) : [],
      addressLine: row.addressLine,
      city: row.city,
      zipCode: row.zipCode,
      slotDate: row.slotDate.toISOString().slice(0, 10),
      slotWindow: row.slotWindow,
      status: row.status,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
