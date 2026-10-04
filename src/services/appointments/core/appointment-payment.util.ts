/**
 * The single definition of "this appointment is paid (or comped)", shared by everything that gates
 * a visit on payment: joining the video room, completing the visit, and deciding whether an
 * unattended visit may still be cancelled or must be expired with its payment left as it is.
 *
 * It is a union: any one recognised signal is enough. A visit that is joinable must never be
 * un-completable because two services read the same payment data differently. A visit covered by
 * a subscription plan counts as comped.
 */

import { isPaidPaymentStatus } from '@utils/currency.util';

interface PaymentEntryLike {
  readonly status?: string | null | undefined;
  readonly invoice?:
    | { readonly status?: string | null | undefined; readonly paid?: boolean | null | undefined }
    | null
    | undefined;
}

interface BillingLike {
  readonly paymentStatus?: string | null | undefined;
  readonly status?: string | null | undefined;
  readonly paid?: boolean | null | undefined;
}

export interface AppointmentPaymentLike {
  readonly payment?: PaymentEntryLike | readonly PaymentEntryLike[] | null | undefined;
  readonly paymentStatus?: string | null | undefined;
  readonly billing?: BillingLike | null | undefined;
  readonly invoice?: BillingLike | null | undefined;
  readonly paymentCompleted?: boolean | null | undefined;
  readonly isPaid?: boolean | null | undefined;
  readonly paid?: boolean | null | undefined;
  readonly subscriptionId?: string | null | undefined;
  readonly isSubscriptionBased?: boolean | null | undefined;
}

const isPaidStatus = isPaidPaymentStatus;

function toPaymentEntries(payment: AppointmentPaymentLike['payment']): readonly PaymentEntryLike[] {
  if (!payment) {
    return [];
  }
  return Array.isArray(payment)
    ? (payment as readonly PaymentEntryLike[])
    : [payment as PaymentEntryLike];
}

export function isAppointmentPaid(appointment: AppointmentPaymentLike): boolean {
  if (
    appointment.paymentCompleted === true ||
    appointment.isPaid === true ||
    appointment.paid === true
  ) {
    return true;
  }

  // Comped: covered by a subscription plan.
  if (appointment.isSubscriptionBased === true && Boolean(appointment.subscriptionId)) {
    return true;
  }

  const paidThroughPayment = toPaymentEntries(appointment.payment).some(
    entry =>
      isPaidStatus(entry.status) ||
      isPaidStatus(entry.invoice?.status) ||
      entry.invoice?.paid === true
  );
  if (paidThroughPayment) {
    return true;
  }

  return (
    isPaidStatus(appointment.paymentStatus) ||
    isPaidStatus(appointment.billing?.paymentStatus) ||
    isPaidStatus(appointment.billing?.status) ||
    appointment.billing?.paid === true ||
    isPaidStatus(appointment.invoice?.paymentStatus) ||
    isPaidStatus(appointment.invoice?.status) ||
    appointment.invoice?.paid === true
  );
}
