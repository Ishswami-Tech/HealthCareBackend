import { describe, expect, it } from '@jest/globals';
import {
  isDraftPrescriptionStatus,
  isOffMedicineDesk,
  medicineDeskLifecycleStatus,
} from '../../../src/services/pharmacy/services/medicine-desk-status.util';

describe('medicineDeskLifecycleStatus', () => {
  it('keeps a RETURNED draft as RETURNED (not WAITING_FOR_PAYMENT)', () => {
    expect(medicineDeskLifecycleStatus('RETURNED', 'PENDING')).toBe('RETURNED');
    expect(medicineDeskLifecycleStatus('returned', 'PAID')).toBe('RETURNED');
  });

  it('keeps a DRAFT as DRAFT', () => {
    expect(medicineDeskLifecycleStatus('DRAFT', 'PENDING')).toBe('DRAFT');
  });

  it('maps pharmacy states by payment', () => {
    expect(medicineDeskLifecycleStatus('PENDING', 'PENDING')).toBe('WAITING_FOR_PAYMENT');
    expect(medicineDeskLifecycleStatus('PENDING', 'PARTIAL')).toBe('WAITING_FOR_PAYMENT');
    expect(medicineDeskLifecycleStatus('PENDING', 'PAID')).toBe('READY_FOR_HANDOVER');
    expect(medicineDeskLifecycleStatus('FILLED', 'PENDING')).toBe('DISPENSED');
    expect(medicineDeskLifecycleStatus('CANCELLED', 'PAID')).toBe('CANCELLED');
    expect(medicineDeskLifecycleStatus(null, 'PENDING')).toBe('WAITING_FOR_PAYMENT');
  });
});

describe('draft / desk membership', () => {
  it('detects drafts', () => {
    expect(isDraftPrescriptionStatus('DRAFT')).toBe(true);
    expect(isDraftPrescriptionStatus('RETURNED')).toBe(true);
    expect(isDraftPrescriptionStatus('PENDING')).toBe(false);
    expect(isDraftPrescriptionStatus(undefined)).toBe(false);
  });

  it('keeps drafts, filled and cancelled rows off the desk queue', () => {
    expect(isOffMedicineDesk('DRAFT')).toBe(true);
    expect(isOffMedicineDesk('RETURNED')).toBe(true);
    expect(isOffMedicineDesk('FILLED')).toBe(true);
    expect(isOffMedicineDesk('CANCELLED')).toBe(true);
    expect(isOffMedicineDesk('PENDING')).toBe(false);
    expect(isOffMedicineDesk('PARTIAL')).toBe(false);
  });
});
