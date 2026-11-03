/**
 * Billing Ops Service (clinic admin)
 * @module ClinicOps
 * @description Admin-side billing views that the core billing module does not expose: the money
 * summary, overdue invoices with reminder history, invoice reminders (WhatsApp / SMS, en / mr / hi)
 * and a printable receipt. Creating an invoice, recording a payment and refunding keep using the
 * existing /billing endpoints. NOTHING here is reachable by DOCTOR / ASSISTANT_DOCTOR.
 */

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventService } from '@infrastructure/events/event.service';
import { OpsDbService, type OpsActor } from './ops-db.service';
import {
  addDays,
  displayName,
  parseDay,
  startOfUtcDay,
  type InvoiceLiteRow,
} from '../clinic-ops.types';
import type { SendInvoiceReminderDto } from '../dto/clinic-ops.dto';

/** One reminder per invoice per this many hours (stops accidental double-sends). */
const REMINDER_COOLDOWN_HOURS = 12;

export interface BillingSummaryResponse {
  from: string;
  to: string;
  billed: { amount: number; count: number };
  collected: { amount: number; count: number };
  outstanding: { amount: number; count: number };
  overdue: { amount: number; count: number };
}

export interface OverdueInvoiceResponse {
  invoiceId: string;
  invoiceNumber: string;
  patientName: string;
  patientPhone: string | null;
  amount: number;
  dueDate: string;
  daysOverdue: number;
  billType: string;
  remindersSent: number;
  lastReminderAt: string | null;
}

export interface InvoiceReminderResponse {
  id: string;
  invoiceId: string;
  channel: string;
  language: string;
  message: string | null;
  status: string;
  scheduledFor: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface ReceiptResponse {
  receiptNumber: string;
  invoiceId: string;
  status: string;
  issuedAt: string;
  clinic: { name: string; address: string; phone: string };
  patientName: string;
  billType: string;
  description: string | null;
  lineItems: unknown;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  payments: Array<{ method: string | null; amount: number; paidAt: string }>;
}

const DEFAULT_MESSAGES: Record<
  'en' | 'mr' | 'hi',
  (name: string, amount: string, no: string) => string
> = {
  en: (name, amount, no) =>
    `Hello ${name}, this is a gentle reminder that invoice ${no} of Rs ${amount} is pending. Please pay at the clinic desk. Thank you.`,
  mr: (name, amount, no) =>
    `नमस्कार ${name}, बिल ${no} चे रु ${amount} बाकी आहेत. कृपया क्लिनिकच्या काउंटरवर भरणा करा. धन्यवाद.`,
  hi: (name, amount, no) =>
    `नमस्ते ${name}, बिल ${no} के रु ${amount} बाकी हैं। कृपया क्लिनिक काउंटर पर भुगतान करें। धन्यवाद।`,
};

@Injectable()
export class BillingOpsService {
  constructor(
    private readonly ops: OpsDbService,
    private readonly eventService: EventService
  ) {}

  async summary(clinicId: string, from?: string, to?: string): Promise<BillingSummaryResponse> {
    const end = parseDay(to) ?? startOfUtcDay(new Date());
    const start = parseDay(from) ?? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    const endExclusive = addDays(startOfUtcDay(end), 1);
    const now = new Date();

    const [billed, collected, outstanding, overdue] = await this.ops.read(client =>
      Promise.all([
        client.invoice.aggregate({
          where: {
            clinicId,
            status: { not: 'VOID' },
            createdAt: { gte: start, lt: endExclusive },
          },
          _sum: { totalAmount: true },
          _count: { _all: true },
        }),
        client.invoice.aggregate({
          where: { clinicId, status: 'PAID', paidAt: { gte: start, lt: endExclusive } },
          _sum: { totalAmount: true },
          _count: { _all: true },
        }),
        client.invoice.aggregate({
          where: { clinicId, status: 'PENDING' },
          _sum: { totalAmount: true },
          _count: { _all: true },
        }),
        client.invoice.aggregate({
          where: { clinicId, status: 'PENDING', dueDate: { lt: now } },
          _sum: { totalAmount: true },
          _count: { _all: true },
        }),
      ])
    );
    const pick = (r: { _sum: { totalAmount: number | null }; _count: { _all: number } }) => ({
      amount: Math.round((r._sum.totalAmount ?? 0) * 100) / 100,
      count: r._count._all,
    });
    return {
      from: start.toISOString().slice(0, 10),
      to: startOfUtcDay(end).toISOString().slice(0, 10),
      billed: pick(billed),
      collected: pick(collected),
      outstanding: pick(outstanding),
      overdue: pick(overdue),
    };
  }

  async listOverdue(clinicId: string, limit = 100): Promise<OverdueInvoiceResponse[]> {
    const now = new Date();
    const invoices = await this.ops.read(client =>
      client.invoice.findMany({
        where: { clinicId, status: 'PENDING', dueDate: { lt: now } },
        select: {
          id: true,
          invoiceNumber: true,
          userId: true,
          totalAmount: true,
          dueDate: true,
          billType: true,
        },
        orderBy: { dueDate: 'asc' },
        take: Math.min(Math.max(limit, 1), 300),
      })
    );
    if (!invoices.length) return [];
    const userIds = [...new Set(invoices.map(i => i.userId))];
    const invoiceIds = invoices.map(i => i.id);
    const [users, reminders] = await Promise.all([
      this.ops.read(client =>
        client.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, firstName: true, lastName: true, phone: true },
        })
      ),
      this.ops.read(client =>
        client.invoiceReminder.findMany({
          where: { clinicId, invoiceId: { in: invoiceIds }, status: { in: ['SENT', 'SCHEDULED'] } },
          orderBy: { createdAt: 'desc' },
        })
      ),
    ]);
    const userById = new Map(users.map(u => [u.id, u]));
    return invoices.map(inv => {
      const mine = reminders.filter(r => r.invoiceId === inv.id);
      const user = userById.get(inv.userId) ?? null;
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        patientName: displayName(user),
        patientPhone: user?.phone ?? null,
        amount: inv.totalAmount,
        dueDate: inv.dueDate.toISOString().slice(0, 10),
        daysOverdue: Math.max(
          1,
          Math.floor((now.getTime() - inv.dueDate.getTime()) / (24 * 60 * 60 * 1000))
        ),
        billType: inv.billType,
        remindersSent: mine.length,
        lastReminderAt: mine[0] ? mine[0].createdAt.toISOString() : null,
      };
    });
  }

  async listReminders(invoiceId: string, clinicId: string): Promise<InvoiceReminderResponse[]> {
    await this.loadInvoice(invoiceId, clinicId);
    const rows = await this.ops.read(client =>
      client.invoiceReminder.findMany({
        where: { clinicId, invoiceId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
    );
    return rows.map(r => this.toReminder(r));
  }

  async sendReminder(
    invoiceId: string,
    dto: SendInvoiceReminderDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<InvoiceReminderResponse> {
    const invoice = await this.loadInvoice(invoiceId, clinicId);
    if (invoice.status !== 'PENDING') {
      throw new BadRequestException(
        `Reminders are only for unpaid invoices (this one is ${invoice.status})`
      );
    }
    const recent = await this.ops.read(client =>
      client.invoiceReminder.findFirst({
        where: {
          clinicId,
          invoiceId,
          status: { in: ['SENT', 'SCHEDULED'] },
          createdAt: { gte: new Date(Date.now() - REMINDER_COOLDOWN_HOURS * 60 * 60 * 1000) },
        },
      })
    );
    if (recent) {
      throw new BadRequestException(
        `A reminder was already sent in the last ${REMINDER_COOLDOWN_HOURS} hours for this invoice`
      );
    }
    const scheduledFor = dto.scheduledFor ? new Date(dto.scheduledFor) : null;
    if (scheduledFor && scheduledFor.getTime() <= Date.now()) {
      throw new BadRequestException('scheduledFor must be in the future');
    }
    const user = await this.ops.read(client =>
      client.user.findFirst({
        where: { id: invoice.userId },
        select: { id: true, name: true, firstName: true, lastName: true, phone: true },
      })
    );
    if (!user?.phone) {
      throw new BadRequestException('The patient has no phone number on file to remind');
    }
    const language = dto.language ?? 'en';
    const channel = dto.channel ?? 'WHATSAPP';
    const message =
      dto.message?.trim() ||
      DEFAULT_MESSAGES[language](
        displayName(user),
        invoice.totalAmount.toFixed(2),
        invoice.invoiceNumber
      );
    const immediate = !scheduledFor;

    const row = await this.ops.write(
      client =>
        client.invoiceReminder.create({
          data: {
            clinicId,
            invoiceId,
            channel,
            language,
            message,
            status: immediate ? 'SENT' : 'SCHEDULED',
            scheduledFor,
            sentAt: immediate ? new Date() : null,
            sentById: actor.userId,
          },
        }),
      {
        actor,
        clinicId,
        resourceType: 'INVOICE_REMINDER',
        operation: 'CREATE',
        resourceId: invoiceId,
        details: { channel, language, scheduled: !immediate },
      }
    );
    // The communication layer picks this up and delivers on the chosen channel.
    await this.eventService.emit('billing.invoice.reminder.requested', {
      reminderId: row.id,
      invoiceId,
      clinicId,
      userId: invoice.userId,
      phone: user.phone,
      channel,
      language,
      message,
      scheduledFor: scheduledFor ? scheduledFor.toISOString() : null,
    });
    return this.toReminder(row);
  }

  async receipt(invoiceId: string, clinicId: string): Promise<ReceiptResponse> {
    const invoice = await this.ops.read(client =>
      client.invoice.findFirst({
        where: { id: invoiceId, clinicId },
        include: {
          payments: {
            where: { status: 'COMPLETED' },
            orderBy: { createdAt: 'asc' },
          },
        },
      })
    );
    if (!invoice) throw new NotFoundException('Invoice not found');
    const [clinic, user] = await Promise.all([
      this.ops.read(client =>
        client.clinic.findFirst({
          where: { id: clinicId },
          select: { id: true, name: true, address: true, phone: true },
        })
      ),
      this.ops.read(client =>
        client.user.findFirst({
          where: { id: invoice.userId },
          select: { id: true, name: true, firstName: true, lastName: true },
        })
      ),
    ]);
    return {
      receiptNumber: invoice.invoiceNumber,
      invoiceId: invoice.id,
      status: invoice.status,
      issuedAt: (invoice.paidAt ?? invoice.createdAt).toISOString(),
      clinic: {
        name: clinic?.name ?? '',
        address: clinic?.address ?? '',
        phone: clinic?.phone ?? '',
      },
      patientName: displayName(user),
      billType: invoice.billType,
      description: invoice.description,
      lineItems: invoice.lineItems ?? [],
      subtotal: invoice.amount,
      tax: invoice.tax ?? 0,
      discount: invoice.discount ?? 0,
      total: invoice.totalAmount,
      payments: (invoice.payments ?? []).map(p => ({
        method: p.method,
        amount: p.amount,
        paidAt: (p.paidAt ?? p.createdAt).toISOString(),
      })),
    };
  }

  private async loadInvoice(invoiceId: string, clinicId: string): Promise<InvoiceLiteRow> {
    const invoice = await this.ops.read(client =>
      client.invoice.findFirst({ where: { id: invoiceId, clinicId } })
    );
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  private toReminder(r: {
    id: string;
    invoiceId: string;
    channel: string;
    language: string;
    message: string | null;
    status: string;
    scheduledFor: Date | null;
    sentAt: Date | null;
    createdAt: Date;
  }): InvoiceReminderResponse {
    return {
      id: r.id,
      invoiceId: r.invoiceId,
      channel: r.channel,
      language: r.language,
      message: r.message,
      status: r.status,
      scheduledFor: r.scheduledFor ? r.scheduledFor.toISOString() : null,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
