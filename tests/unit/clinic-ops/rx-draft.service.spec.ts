import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });
jest.mock('@services/pharmacy/services/pharmacy.service', () => ({
  PharmacyService: class PharmacyService {},
}));

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RxDraftService } from '@services/clinic-ops/services/rx-draft.service';

type Row = Record<string, unknown>;

function draftRow(overrides: Row = {}): Row {
  return {
    id: 'rx-1',
    clinicId: 'clinic-1',
    patientId: 'pat-1',
    doctorId: 'doc-1',
    status: 'DRAFT',
    diagnosis: 'Amlapitta',
    notes: null,
    draftedByUserId: 'assistant-1',
    draftedByRole: 'ASSISTANT_DOCTOR',
    draftSnapshot: null,
    submittedAt: new Date('2026-10-20T04:00:00Z'),
    returnedAt: null,
    returnedByUserId: null,
    returnNote: null,
    approvedAt: null,
    approvedByUserId: null,
    doctor: { id: 'doc-1', userId: 'doctor-user' },
    patient: { id: 'pat-1', user: { name: 'Asha Patil', firstName: null, lastName: null } },
    items: [
      {
        id: 'i1',
        medicineId: 'm1',
        dosage: '1 tab',
        frequency: 'BD',
        duration: '5 days',
        quantity: 10,
        instructions: 'after food',
        medicine: { id: 'm1', name: 'Avipattikar' },
      },
    ],
    ...overrides,
  };
}

describe('RxDraftService', () => {
  let row: Row;
  let updateMany: jest.Mock<(args: Row) => Promise<{ count: number }>>;
  let findMany: jest.Mock<(args: Row) => Promise<Row[]>>;
  let publish: jest.Mock<(id: string, clinicId: string) => Promise<void>>;
  let log: jest.Mock<(...args: unknown[]) => Promise<void>>;
  let service: RxDraftService;

  beforeEach(() => {
    row = draftRow();
    updateMany = jest.fn(async () => ({ count: 1 }));
    findMany = jest.fn(async () => [row]);
    publish = jest.fn(async () => undefined);
    log = jest.fn(async () => undefined);
    const client = {
      prescription: { findFirst: jest.fn(async () => row), findMany, updateMany },
      user: { findMany: jest.fn(async () => [{ id: 'assistant-1', name: 'Dr. Meera' }]) },
    };
    const ops = {
      read: (fn: (c: unknown) => unknown) => fn(client),
      write: (fn: (c: unknown) => unknown) => fn(client),
    };
    service = new RxDraftService(
      ops as never,
      {
        publishApprovedPrescription: publish,
        invalidatePrescriptionListCache: jest.fn(async () => undefined),
      } as never,
      { emit: jest.fn(async () => undefined) } as never,
      { log } as never
    );
  });

  it('a doctor only lists and opens drafts written for them', async () => {
    await service.list('clinic-1', { userId: 'doctor-user', role: 'DOCTOR' });
    expect((findMany.mock.calls[0]?.[0] as { where: Row }).where).toMatchObject({
      doctor: { userId: 'doctor-user' },
    });
    findMany.mockClear();
    await service.list('clinic-1', { userId: 'doctor-user', role: 'DOCTOR' }, 'APPROVED');
    expect((findMany.mock.calls[0]?.[0] as { where: Row }).where).toMatchObject({
      doctor: { userId: 'doctor-user' },
    });
    await expect(
      service.get('rx-1', 'clinic-1', { userId: 'other-doctor', role: 'DOCTOR' })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('approving again after a failed desk publish re-publishes instead of failing', async () => {
    row = draftRow({ status: 'PENDING', approvedByUserId: 'doctor-user', approvedAt: new Date() });
    await service.approve('rx-1', 'clinic-1', { userId: 'doctor-user', role: 'DOCTOR' });
    expect(updateMany).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith('rx-1', 'clinic-1');
  });

  it('a desk publish failure after the approval is retried, logged and not thrown', async () => {
    publish.mockRejectedValue(new Error('queue down'));
    await expect(
      service.approve('rx-1', 'clinic-1', { userId: 'doctor-user', role: 'DOCTOR' })
    ).resolves.toBeDefined();
    expect(publish).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('lets only the treating doctor approve, and publishes to the pharmacy desk', async () => {
    await expect(
      service.approve('rx-1', 'clinic-1', { userId: 'assistant-1', role: 'ASSISTANT_DOCTOR' })
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.approve('rx-1', 'clinic-1', { userId: 'other-doctor', role: 'DOCTOR' })
    ).rejects.toBeInstanceOf(ForbiddenException);

    row = draftRow();
    await service.approve('rx-1', 'clinic-1', { userId: 'doctor-user', role: 'DOCTOR' });
    const call = updateMany.mock.calls[0]?.[0] as { where: Row; data: Row };
    expect(call.where).toMatchObject({ id: 'rx-1', status: 'DRAFT' });
    expect(call.data).toMatchObject({ status: 'PENDING', approvedByUserId: 'doctor-user' });
    expect(publish).toHaveBeenCalledWith('rx-1', 'clinic-1');
  });

  it('refuses to approve something that is not an awaiting draft', async () => {
    row = draftRow({ status: 'RETURNED' });
    await expect(
      service.approve('rx-1', 'clinic-1', { userId: 'doctor-user', role: 'DOCTOR' })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(publish).not.toHaveBeenCalled();
  });

  it('returns a draft with a note and keeps a snapshot of what the doctor saw', async () => {
    await service.returnDraft('rx-1', { note: 'Reduce to 5 tabs' }, 'clinic-1', {
      userId: 'doctor-user',
      role: 'DOCTOR',
    });
    const call = updateMany.mock.calls[0]?.[0] as { data: Row };
    expect(call.data).toMatchObject({ status: 'RETURNED', returnNote: 'Reduce to 5 tabs' });
    expect(call.data['draftSnapshot']).toMatchObject({ diagnosis: 'Amlapitta' });
  });

  it('only the author can resubmit a returned draft', async () => {
    row = draftRow({ status: 'RETURNED' });
    await expect(
      service.resubmit('rx-1', 'clinic-1', { userId: 'assistant-2', role: 'ASSISTANT_DOCTOR' })
    ).rejects.toBeInstanceOf(ForbiddenException);
    await service.resubmit('rx-1', 'clinic-1', { userId: 'assistant-1', role: 'ASSISTANT_DOCTOR' });
    expect((updateMany.mock.calls[0]?.[0] as { data: Row }).data).toMatchObject({
      status: 'DRAFT',
    });
  });

  it('stores an optional resubmit note next to the returned snapshot', async () => {
    row = draftRow({ status: 'RETURNED', draftSnapshot: { diagnosis: 'Amlapitta', items: [] } });
    await service.resubmit(
      'rx-1',
      'clinic-1',
      { userId: 'assistant-1', role: 'ASSISTANT_DOCTOR' },
      '  Dose reduced as asked  '
    );
    const data = (updateMany.mock.calls[0]?.[0] as { data: Row }).data;
    expect(data['draftSnapshot']).toMatchObject({
      diagnosis: 'Amlapitta',
      resubmitNote: 'Dose reduced as asked',
    });

    // No note and none before: the snapshot is left alone.
    updateMany.mockClear();
    row = draftRow({ status: 'RETURNED', draftSnapshot: { diagnosis: 'x' } });
    await service.resubmit('rx-1', 'clinic-1', { userId: 'assistant-1', role: 'ASSISTANT_DOCTOR' });
    expect((updateMany.mock.calls[0]?.[0] as { data: Row }).data).not.toHaveProperty(
      'draftSnapshot'
    );
  });

  it('exposes the resubmit note on the draft', async () => {
    row = draftRow({ draftSnapshot: { resubmitNote: 'fixed' } });
    const out = await service.get('rx-1', 'clinic-1', { userId: 'doctor-user', role: 'DOCTOR' });
    expect(out.resubmitNote).toBe('fixed');
  });

  it('status=APPROVED lists recently approved drafts (assistant: own), newest first', async () => {
    row = draftRow({ status: 'PENDING', approvedAt: new Date() });
    await service.list(
      'clinic-1',
      { userId: 'assistant-1', role: 'ASSISTANT_DOCTOR' },
      'approved',
      7
    );
    const args = findMany.mock.calls[0]?.[0] as { where: Row; orderBy: Row };
    expect(args.where).toMatchObject({ clinicId: 'clinic-1', draftedByUserId: 'assistant-1' });
    const since = (args.where['approvedAt'] as { gte: Date }).gte.getTime();
    expect(Date.now() - since).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
    expect(Date.now() - since).toBeLessThan(7.1 * 24 * 3600 * 1000);
    expect(args.orderBy).toEqual({ approvedAt: 'desc' });

    findMany.mockClear();
    await service.list('clinic-1', { userId: 'doctor-user', role: 'DOCTOR' }, 'APPROVED');
    expect((findMany.mock.calls[0]?.[0] as { where: Row }).where['draftedByUserId']).toEqual({
      not: null,
    });
  });

  it('scopes the assistant list to their own drafts and never exposes prices', async () => {
    const out = await service.list('clinic-1', { userId: 'assistant-1', role: 'ASSISTANT_DOCTOR' });
    expect((findMany.mock.calls[0]?.[0] as { where: Row }).where).toMatchObject({
      draftedByUserId: 'assistant-1',
    });
    expect(JSON.stringify(out)).not.toMatch(/price|amount/i);
    expect(out[0]).toMatchObject({ patientName: 'Asha Patil', draftedByName: 'Dr. Meera' });
    await expect(
      service.list('clinic-1', { userId: 'doctor-user', role: 'DOCTOR' }, 'FILLED')
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
