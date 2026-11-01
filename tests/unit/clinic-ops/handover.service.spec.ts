import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });

import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
  HandoverService,
  extractHandoverCode,
  hashHandoverCode,
  parseHandoverInput,
} from '@services/clinic-ops/services/handover.service';

type Row = Record<string, unknown>;

const qrFake = { generateQR: jest.fn(async (text: string) => `data:image/png;base64,QR(${text})`) };
const pharmacyFake = {
  invalidatePrescriptionListCache: jest.fn(async (_context: Record<string, string>) => undefined),
  findPrescriptionsByPatient: jest.fn(
    async (_userId: string, _caller: unknown): Promise<Row[]> => []
  ),
};
const eventFake = { emit: jest.fn(async () => undefined) };

describe('HandoverService', () => {
  let created: Row[];
  let service: HandoverService;
  let forceNoClaim: boolean;
  let payments: Array<{ amount: number }>;
  let rx: Row;
  let nextHandoverId: string;
  // Ready for hand-over: approved, dispensed and paid (see handover-readiness.util).
  const readyRx = (): Row => ({
    id: 'rx-1',
    clinicId: 'c1',
    patientId: 'p1',
    doctorId: 'd1',
    status: 'FILLED',
    patient: { id: 'p1', userId: 'patient-user', user: { name: 'Priya Sharma' } },
    items: [
      {
        id: 'i1',
        dosage: '1 tab',
        frequency: 'BD',
        duration: '5d',
        quantity: 10,
        dispensedQuantity: 10,
        medicine: { id: 'm1', name: 'Avipattikar', price: 2 },
      },
    ],
  });

  // Every hand-over row the fake database holds (newest last).
  let rows: Row[];
  let listRows: Row[];
  const current = (): Row | undefined => rows[rows.length - 1];

  beforeEach(() => {
    rows = [];
    listRows = [];
    pharmacyFake.findPrescriptionsByPatient.mockImplementation(async () => listRows);
    nextHandoverId = 'h1';
    created = [];
    forceNoClaim = false;
    rx = readyRx();
    payments = [{ amount: 20 }];
    const client = {
      prescription: { findFirst: jest.fn(async () => rx) },
      payment: { findMany: jest.fn(async () => payments) },
      invoice: { findFirst: jest.fn(async () => null) },
      patient: {
        findFirst: jest.fn(async () => ({
          id: 'p1',
          userId: 'patient-user',
          user: { phone: '+919000004321' },
        })),
      },
      patientIdentifier: { findMany: jest.fn(async () => [{ value: 'UH-0007' }]) },
      dispenseHandover: {
        findFirst: jest.fn(async ({ where }: { where: Row }) => {
          const hits = rows.filter(row => matchesWhere(row, where));
          return hits[hits.length - 1] ?? null;
        }),
        findMany: jest.fn(async ({ where }: { where: Row }) =>
          rows.filter(row => matchesWhere(row, where)).reverse()
        ),
        create: jest.fn(async ({ data }: { data: Row }) => {
          const row: Row = {
            id: nextHandoverId,
            otpAttempts: 0,
            verifiedAt: null,
            createdAt: new Date(),
            ...data,
          };
          rows.push(row);
          created.push(row);
          nextHandoverId = `${nextHandoverId}x`;
          return row;
        }),
        update: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
          const index = rows.findIndex(row => row['id'] === where['id']);
          rows[index] = applyData(rows[index] as Row, data);
          return rows[index];
        }),
        // Honours the `where` guards (lt / gt / not / gte / equality) the service relies on.
        updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
          if (forceNoClaim) return { count: 0 };
          let count = 0;
          rows = rows.map(row => {
            if (!matchesWhere(row, where)) return row;
            count += 1;
            return applyData(row, data);
          });
          return { count };
        }),
      },
    };
    const ops = {
      read: (fn: (c: unknown) => unknown) => fn(client),
      write: (fn: (c: unknown) => unknown) => fn(client),
    };
    service = new HandoverService(
      ops as never,
      { record: jest.fn(async () => undefined) } as never,
      qrFake as never,
      pharmacyFake as never,
      eventFake as never
    );
  });

  function applyData(row: Row, data: Row): Row {
    const next: Row = { ...row };
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'object' && value !== null && 'increment' in value) {
        next[key] = Number(next[key] ?? 0) + Number((value as { increment: number }).increment);
      } else if (typeof value === 'object' && value !== null && 'decrement' in value) {
        next[key] = Number(next[key] ?? 0) - Number((value as { decrement: number }).decrement);
      } else {
        next[key] = value;
      }
    }
    return next;
  }

  function matchesWhere(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, cond]) => {
      if (key === 'OR') {
        return (cond as Row[]).some(branch => matchesWhere(row, branch));
      }
      const actual = row[key] ?? null;
      if (cond instanceof Date || cond === null || typeof cond !== 'object') {
        return actual === cond;
      }
      const c = cond as { lt?: number; gt?: number; not?: unknown; gte?: Date; lte?: Date };
      if (c.lt !== undefined && !(Number(actual) < c.lt)) return false;
      if (c.gt !== undefined && !(Number(actual) > c.gt)) return false;
      if (c.not !== undefined && actual === c.not) return false;
      if (c.gte !== undefined && !((actual as Date).getTime() >= c.gte.getTime())) return false;
      if (c.lte !== undefined && !((actual as Date).getTime() <= c.lte.getTime())) return false;
      return true;
    });
  }

  it('claims an attempt before comparing and stops after five, even for the right code', async () => {
    const issued = await service.issueCode('rx-1', 'c1', {
      userId: 'patient-user',
      role: 'PATIENT',
    });
    const wrong = issued.code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await expect(
        service.verify('rx-1', { code: wrong }, 'c1', { userId: 'ph', role: 'PHARMACIST' })
      ).rejects.toThrow('That code does not match');
    }
    expect(current()?.['otpAttempts']).toBe(5);
    await expect(
      service.verify('rx-1', { code: issued.code }, 'c1', { userId: 'ph', role: 'PHARMACIST' })
    ).rejects.toThrow(/Too many wrong codes/);
    expect(current()?.['verifiedAt']).toBeNull();
  });

  it('returns the QR as a PNG data URL of qrPayload and busts the prescription cache', async () => {
    pharmacyFake.invalidatePrescriptionListCache.mockClear();
    const issued = await service.issueCode('rx-1', 'c1', {
      userId: 'patient-user',
      role: 'PATIENT',
    });
    expect(issued.qrImage).toBe(`data:image/png;base64,QR(${issued.qrPayload})`);
    expect(pharmacyFake.invalidatePrescriptionListCache).toHaveBeenCalledWith({
      prescriptionId: 'rx-1',
      clinicId: 'c1',
    });
  });

  it('still issues the code when the QR image cannot be rendered', async () => {
    qrFake.generateQR.mockRejectedValueOnce(new Error('render failed'));
    const issued = await service.issueCode('rx-1', 'c1', {
      userId: 'patient-user',
      role: 'PATIENT',
    });
    expect(issued.qrImage).toBeNull();
    expect(issued.code).toMatch(/^\d{6}$/);
  });

  it('keys the stored hash with the server secret when configured', async () => {
    let storedHash: unknown;
    const fake = {
      prescription: { findFirst: async () => rx },
      payment: { findMany: async () => payments },
      invoice: { findFirst: async () => null },
      dispenseHandover: {
        findFirst: async () => null,
        create: async () => ({ id: 'h9', createdAt: new Date() }),
        update: async ({ data }: { data: Row }) => {
          storedHash = data['otpHash'];
          return { id: 'h9' };
        },
        updateMany: async () => ({ count: 0 }),
      },
    };
    const keyed = new HandoverService(
      {
        read: (fn: (c: unknown) => unknown) => fn(fake),
        write: (fn: (c: unknown) => unknown) => fn(fake),
      } as never,
      { record: async () => undefined } as never,
      qrFake as never,
      pharmacyFake as never,
      eventFake as never,
      { getEnv: (key: string) => (key === 'JWT_SECRET' ? 'server-secret' : undefined) } as never
    );
    const issued = await keyed.issueCode('rx-1', 'c1', { userId: 'patient-user', role: 'PATIENT' });
    expect(storedHash).toBe(hashHandoverCode('h9', issued.code, 'server-secret'));
    expect(storedHash).not.toBe(hashHandoverCode('h9', issued.code));
  });

  it('undo refuses when the guarded write claims nothing', async () => {
    rows = [
      {
        id: 'h1',
        clinicId: 'c1',
        prescriptionId: 'rx-1',
        status: 'HANDED_OVER',
        handedOverById: 'ph',
        undoUntil: new Date(Date.now() + 60_000),
      },
    ];
    await service.undo('h1', 'c1', { userId: 'ph', role: 'PHARMACIST' });
    expect(current()?.['status']).toBe('UNDONE');
    // A second undo racing the first: the row reads HANDED_OVER but the write claims nothing.
    rows = [{ ...(current() as Row), status: 'HANDED_OVER' }];
    forceNoClaim = true;
    await expect(
      service.undo('h1', 'c1', { userId: 'ph', role: 'PHARMACIST' })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('verifies with the raw QR text and records the method as QR', async () => {
    nextHandoverId = '22222222-2222-4222-8222-222222222222';
    const issued = await service.issueCode('rx-1', 'c1', {
      userId: 'patient-user',
      role: 'PATIENT',
    });
    expect(issued.qrPayload).toMatch(/^TBD-HO:22222222-2222-4222-8222-222222222222:\d{6}$/);

    const verified = await service.verify('rx-1', { code: issued.qrPayload }, 'c1', {
      userId: 'ph',
      role: 'PHARMACIST',
    });

    expect(verified.verified).toBe(true);
    expect(current()?.['method']).toBe('QR');
  });

  it('refuses a QR of another hand-over without spending an attempt', async () => {
    nextHandoverId = '22222222-2222-4222-8222-222222222222';
    const issued = await service.issueCode('rx-1', 'c1', {
      userId: 'patient-user',
      role: 'PATIENT',
    });
    const otherQr = `TBD-HO:33333333-3333-4333-8333-333333333333:${issued.code}`;

    await expect(
      service.verify('rx-1', { code: otherQr }, 'c1', { userId: 'ph', role: 'PHARMACIST' })
    ).rejects.toThrow(/not for this patient/);
    expect(current()?.['otpAttempts']).toBe(0);
    expect(current()?.['verifiedAt']).toBeNull();
  });

  it('parses the QR text (code + hand-over id) and the bare code', () => {
    expect(parseHandoverInput(' 123456 ')).toEqual({ code: '123456' });
    expect(parseHandoverInput('TBD-HO:AAAAAAAA-1111-4111-8111-111111111111:654321')).toEqual({
      code: '654321',
      handoverId: 'aaaaaaaa-1111-4111-8111-111111111111',
    });
  });

  it('extracts the code from a QR payload or a bare code', () => {
    expect(extractHandoverCode('123456')).toBe('123456');
    expect(extractHandoverCode('TBD-HO:11111111-1111-1111-1111-111111111111:654321')).toBe(
      '654321'
    );
  });

  it('only the owning patient can issue a code', async () => {
    await expect(
      service.issueCode('rx-1', 'c1', { userId: 'someone-else', role: 'PATIENT' })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('issues a code, verifies it, rejects a wrong one, then confirms', async () => {
    const issued = await service.issueCode('rx-1', 'c1', {
      userId: 'patient-user',
      role: 'PATIENT',
    });
    expect(issued.code).toMatch(/^\d{6}$/);
    expect(current()?.['otpHash']).toBe(hashHandoverCode('h1', issued.code));

    const wrong = issued.code === '000000' ? '111111' : '000000';
    await expect(
      service.verify('rx-1', { code: wrong }, 'c1', { userId: 'ph', role: 'PHARMACIST' })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(current()?.['otpAttempts']).toBe(1);

    // not verified yet -> cannot confirm
    await expect(
      service.confirm(
        'h1',
        {
          itemChecklist: [{ prescriptionItemId: 'i1', handedOver: true }],
          acknowledgedBy: 'Priya',
        },
        'c1',
        { userId: 'ph', role: 'PHARMACIST' }
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    const verified = await service.verify(
      'rx-1',
      { code: issued.qrPayload.split(':')[2] as string },
      'c1',
      {
        userId: 'ph',
        role: 'PHARMACIST',
      }
    );
    expect(verified.verified).toBe(true);
    expect(verified.items[0]?.medicineName).toBe('Avipattikar');

    const done = await service.confirm(
      'h1',
      { itemChecklist: [{ prescriptionItemId: 'i1', handedOver: true }], acknowledgedBy: 'Priya' },
      'c1',
      { userId: 'ph', role: 'PHARMACIST' }
    );
    expect(done.status).toBe('HANDED_OVER');
    expect(done.canUndo).toBe(true);
  });
  it('refuses a hand-over code until the prescription is paid and dispensed (B4)', async () => {
    const patient = { userId: 'patient-user', role: 'PATIENT' };
    rx = { ...readyRx(), status: 'PENDING' };
    rx['items'] = [{ ...(readyRx()['items'] as Row[])[0], dispensedQuantity: 0 }];
    await expect(service.issueCode('rx-1', 'c1', patient)).rejects.toBeInstanceOf(
      ConflictException
    );

    rx = readyRx();
    payments = [{ amount: 5 }];
    await expect(service.issueCode('rx-1', 'c1', patient)).rejects.toThrow(/payment/i);

    rx = { ...readyRx(), status: 'DRAFT' };
    payments = [{ amount: 20 }];
    await expect(service.issueCode('rx-1', 'c1', patient)).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(created).toHaveLength(0);
  });

  describe('one code per patient at the counter', () => {
    const patient = { userId: 'patient-user', role: 'PATIENT' };
    const pharmacist = { userId: 'ph', role: 'PHARMACIST' };
    const secondRx = (): Row => ({
      id: 'rx-2',
      clinicId: 'c1',
      canCollect: true,
      prescriptionNumber: 'RX-20261101-RX2',
      date: '2026-10-31T22:03:06.244Z',
      items: [{ medicine: { name: 'Triphala' } }],
    });

    it('covers every ready prescription of the patient at the clinic and lists them', async () => {
      listRows = [secondRx(), { ...secondRx(), id: 'rx-3', clinicId: 'other-clinic' }];
      const issued = await service.issueCode('rx-1', 'c1', patient);
      expect(issued.prescriptions.map(p => p.prescriptionId)).toEqual(['rx-1', 'rx-2']);
      expect(issued.prescriptions[1]?.medicines).toEqual(['Triphala']);
      expect(rows.map(row => row['prescriptionId'])).toEqual(['rx-1', 'rx-2']);
      for (const row of rows) {
        expect(row['otpHash']).toBe(hashHandoverCode(String(row['id']), issued.code));
      }
    });

    it('verifies all of them from either prescription and spends no attempt', async () => {
      listRows = [secondRx()];
      const issued = await service.issueCode('rx-1', 'c1', patient);
      const verified = await service.verify('rx-2', { code: issued.code }, 'c1', pharmacist);
      expect(verified.prescriptionId).toBe('rx-2');
      expect(verified.alsoVerified?.map(v => v.prescriptionId)).toEqual(['rx-1']);
      expect(rows.every(row => row['verifiedAt'] instanceof Date)).toBe(true);
      expect(rows.every(row => row['otpAttempts'] === 0)).toBe(true);
    });

    it('accepts the right code entered on another prescription of the patient', async () => {
      const issued = await service.issueCode('rx-1', 'c1', patient);
      // The desk opened rx-2 (no code of its own): the code still verifies rx-1, no lockout.
      const verified = await service.verify('rx-2', { code: issued.code }, 'c1', pharmacist);
      expect(verified.prescriptionId).toBe('rx-1');
      expect(current()?.['otpAttempts']).toBe(0);
    });

    it('a wrong code spends one attempt on each live code of the patient', async () => {
      listRows = [secondRx()];
      const issued = await service.issueCode('rx-1', 'c1', patient);
      const wrong = issued.code === '000000' ? '111111' : '000000';
      await expect(service.verify('rx-1', { code: wrong }, 'c1', pharmacist)).rejects.toThrow(
        'That code does not match'
      );
      expect(rows.map(row => row['otpAttempts'])).toEqual([1, 1]);
    });
  });

  describe('hand over without a code', () => {
    const pharmacist = { userId: 'ph', role: 'PHARMACIST' };
    const dto = (
      identityCheck: 'PHONE_LAST4' | 'UHID',
      identityValue: string
    ): { identityCheck: 'PHONE_LAST4' | 'UHID'; identityValue: string; reason: string } => ({
      identityCheck,
      identityValue,
      reason: 'No phone with the patient',
    });

    it('verifies after the phone last-4 check and records the method', async () => {
      const verified = await service.verifyWithoutCode(
        'rx-1',
        dto('PHONE_LAST4', '4321'),
        'c1',
        pharmacist
      );
      expect(verified.verified).toBe(true);
      expect(verified.method).toBe('MANUAL');
    });

    it('accepts the clinic UHID, case-insensitively', async () => {
      const verified = await service.verifyWithoutCode(
        'rx-1',
        dto('UHID', 'uh-0007'),
        'c1',
        pharmacist
      );
      expect(verified.verified).toBe(true);
    });

    it('refuses a wrong identity and verifies nothing', async () => {
      await expect(
        service.verifyWithoutCode('rx-1', dto('PHONE_LAST4', '1111'), 'c1', pharmacist)
      ).rejects.toThrow(/do not match/);
      expect(rows).toHaveLength(0);
    });

    it('still refuses an unpaid prescription', async () => {
      payments = [{ amount: 5 }];
      await expect(
        service.verifyWithoutCode('rx-1', dto('PHONE_LAST4', '4321'), 'c1', pharmacist)
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
