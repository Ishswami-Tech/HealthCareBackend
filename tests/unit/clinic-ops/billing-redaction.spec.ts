/**
 * Billing blindness: DOCTOR and ASSISTANT_DOCTOR responses never carry billing amounts.
 */
import { describe, it, expect } from '@jest/globals';
import { StreamableFile } from '@nestjs/common';
import {
  isBillingBlindRole,
  isBillingKey,
  stripBillingFields,
} from '@core/interceptors/billing-redaction.util';
import {
  DOCTOR_ONLY_VISIT_MESSAGE,
  assertDoctorControlsVisit,
  canControlVisit,
} from '@core/rbac/visit-authority.util';

describe('billing redaction', () => {
  it('flags only the clinical roles', () => {
    expect(isBillingBlindRole('DOCTOR')).toBe(true);
    expect(isBillingBlindRole('assistant_doctor')).toBe(true);
    expect(isBillingBlindRole('CLINIC_ADMIN')).toBe(false);
    expect(isBillingBlindRole('RECEPTIONIST')).toBe(false);
    expect(isBillingBlindRole(undefined)).toBe(false);
  });

  it('matches money keys by word, not by substring', () => {
    for (const key of [
      'amount',
      'totalAmount',
      'consultation_fee',
      'consultationFee',
      'unitPrice',
      'lineTotal',
      'grandTotal',
      'outstandingBalance',
      'collectedToday',
      'refundAmount',
      'taxAmount',
      'discount',
      'revenue',
      'payoutStatus',
    ]) {
      expect(isBillingKey(key)).toBe(true);
    }
    for (const key of ['feedback', 'total', 'dosage', 'quantityOnHand', 'patientName', 'status']) {
      expect(isBillingKey(key)).toBe(false);
    }
  });

  it('strips nested amounts from objects and arrays without touching the rest', () => {
    const date = new Date('2026-10-20T00:00:00.000Z');
    const input = {
      id: 'rx1',
      createdAt: date,
      items: [{ name: 'Ashwagandha', quantity: 2, unitPrice: 40, lineAmount: 80 }],
      invoice: { invoiceNumber: 'INV-1', totalAmount: 500, tax: 5 },
      meta: { total: 3 },
    };
    const out = stripBillingFields(input);
    expect(out).toEqual({
      id: 'rx1',
      createdAt: date,
      items: [{ name: 'Ashwagandha', quantity: 2 }],
      invoice: { invoiceNumber: 'INV-1' },
      meta: { total: 3 },
    });
    // the input is not mutated
    expect(input.items[0]).toHaveProperty('unitPrice', 40);
  });

  it('strips the extra money words but keeps lab collection timestamps and people in charge', () => {
    for (const key of [
      'serviceCharge',
      'charges',
      'billedAmount',
      'billed',
      'payable',
      'gstRate',
      'commission',
      'balance',
      'collection',
      'collectionsToday',
    ]) {
      expect(isBillingKey(key)).toBe(true);
    }
    for (const key of [
      'collectedAt',
      'sampleCollectedAt',
      'collectionDate',
      'sample_collection',
      'specimenCollected',
      'doctorInCharge',
      'in_charge',
    ]) {
      expect(isBillingKey(key)).toBe(false);
    }
  });

  it('returns binary payloads and streams untouched instead of serialising them', () => {
    const buffer = Buffer.from('%PDF-1.7');
    const bytes = new Uint8Array([1, 2, 3]);
    class FakeStream {
      price = 5;
      pipe(): void {
        return undefined;
      }
    }
    const stream = new FakeStream();
    const file = new StreamableFile(buffer);
    expect(stripBillingFields(buffer)).toBe(buffer);
    expect(stripBillingFields(bytes)).toBe(bytes);
    expect(stripBillingFields(stream)).toBe(stream);
    expect(stripBillingFields(file)).toBe(file);
    const nested = stripBillingFields({ file: buffer, amount: 10 });
    expect(nested).toEqual({ file: buffer });
    expect(nested.file).toBe(buffer);
  });

  it('survives cycles and primitives', () => {
    const loop: Record<string, unknown> = { name: 'a', price: 1 };
    loop['self'] = loop;
    expect(() => stripBillingFields(loop)).not.toThrow();
    expect(stripBillingFields('text')).toBe('text');
    expect(stripBillingFields(null)).toBeNull();
  });
});

describe('visit authority', () => {
  it('only the doctor (and the internal system identity) controls a visit', () => {
    expect(canControlVisit('DOCTOR')).toBe(true);
    expect(canControlVisit('system')).toBe(true);
    for (const role of ['ASSISTANT_DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN', 'NURSE', undefined]) {
      expect(canControlVisit(role)).toBe(false);
    }
  });

  it('throws 403 with the product message for anyone else', () => {
    expect(() => assertDoctorControlsVisit('ASSISTANT_DOCTOR')).toThrow(DOCTOR_ONLY_VISIT_MESSAGE);
    expect(() => assertDoctorControlsVisit('DOCTOR')).not.toThrow();
  });
});
