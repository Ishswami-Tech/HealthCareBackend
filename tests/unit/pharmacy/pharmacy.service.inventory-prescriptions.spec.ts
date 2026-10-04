/// <reference types="jest" />
/**
 * Pharmacy inventory edit/soft-delete, doctor prescription edit, prescription payload
 * additions, prescription PDF access and the batch-audit date fixes.
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  PharmacyService,
  buildPrescriptionNumber,
  resolveAuditDateBound,
} from '@services/pharmacy/services/pharmacy.service';
import {
  CreateMedicineDto,
  UpdateInventoryDto,
  resolveMedicineTypeInput,
} from '@dtos/pharmacy.dto';

jest.mock('@infrastructure/database', () => ({ DatabaseService: class DatabaseService {} }));
jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));
jest.mock('@infrastructure/events/event.service', () => ({ EventService: class EventService {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));
jest.mock('@infrastructure/queue', () => ({
  AppointmentQueueService: class AppointmentQueueService {},
}));
jest.mock('@payment/payment.service', () => ({ PaymentService: class PaymentService {} }));
jest.mock('@services/pharmacy-inventory/services/inventory.service', () => ({
  InventoryService: class InventoryService {},
}));
jest.mock('@services/pharmacy-inventory/services/expiry-alert.service', () => ({
  ExpiryAlertService: class ExpiryAlertService {},
}));

const CLINIC = 'clinic-1';
const OTHER_CLINIC = 'clinic-2';
const PHARMACIST = { userId: 'pharm-user', role: 'PHARMACIST' };
const DOCTOR = { userId: 'doc-user', role: 'DOCTOR' };

type Row = Record<string, unknown>;

function createHarness(overrides: Record<string, Record<string, jest.Mock>> = {}) {
  const client: Record<string, Record<string, jest.Mock>> = {
    medicine: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(async ({ data }: { data: Row }) => ({ id: 'med-1', ...data })),
      create: jest.fn(async ({ data }: { data: Row }) => ({ id: 'med-new', ...data })),
    },
    supplier: { findFirst: jest.fn().mockResolvedValue({ id: 'sup-1' }) },
    prescriptionItem: {
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    prescription: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(async ({ data }: { data: Row }) => ({ ...data })),
    },
    appointment: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    patientVisit: { findMany: jest.fn().mockResolvedValue([]) },
    patient: { findUnique: jest.fn().mockResolvedValue({ userId: 'patient-user' }) },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Pharma Cist' }) },
    clinic: { findUnique: jest.fn().mockResolvedValue({ name: 'Ishswami Clinic' }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  const databaseService = {
    executeHealthcareRead: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
    executeHealthcareWrite: jest.fn(
      async (op: (c: unknown) => Promise<unknown>, _audit?: Record<string, unknown>) => op(client)
    ),
    findPaymentsSafe: jest.fn().mockResolvedValue([]),
  };
  const cacheService = { invalidateCacheByTag: jest.fn(), del: jest.fn() };
  const eventService = { emit: jest.fn() };
  const billing = { findPrescriptionInvoices: jest.fn().mockResolvedValue(new Map()) };
  const moduleRef = { get: jest.fn().mockReturnValue(billing) };
  const appointmentQueueService = {
    getOperationalQueue: jest.fn().mockResolvedValue([]),
    removeOperationalQueueItem: jest.fn().mockResolvedValue(undefined),
    enqueueOperationalItem: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PharmacyService(
    databaseService as never,
    {} as never,
    eventService as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    appointmentQueueService as never,
    {} as never,
    {} as never,
    moduleRef as never,
    cacheService as never
  );
  return { service, client, databaseService, cacheService, billing };
}

function medicineRow(extra: Row = {}): Row {
  return { id: 'med-1', clinicId: CLINIC, name: 'Para', stock: 10, isActive: true, ...extra };
}

function prescriptionRow(extra: Row = {}): Row {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    clinicId: CLINIC,
    patientId: 'patient-1',
    doctorId: 'doctor-1',
    status: 'PENDING',
    date: new Date('2026-10-04T20:00:00Z'), // 5 Oct 01:30 IST
    notes: null,
    diagnosis: 'Cold',
    visitId: 'visit-1',
    appointmentId: 'appt-1',
    prescriptionNumber: null,
    items: [
      {
        id: 'item-1',
        quantity: 2,
        dispensedQuantity: 0,
        medicineId: 'med-1',
        dosage: '1 tab',
        medicine: { name: 'Para', price: 10, unit: 'strip' },
      },
    ],
    patient: {
      user: {
        id: 'patient-user',
        name: 'Pat',
        phone: '1',
        email: 'p@x.io',
        age: 40,
        gender: 'FEMALE',
        dateOfBirth: null,
      },
    },
    doctor: { user: { id: 'doc-user', name: 'Dr Doc', role: 'DOCTOR' } },
    location: null,
    ...extra,
  };
}

describe('medicine type mapping + DTO validation', () => {
  it('maps dosage forms to category + PROPRIETARY, keeps DB classifications', () => {
    expect(resolveMedicineTypeInput({ type: 'TABLET' })).toEqual({
      type: 'PROPRIETARY',
      category: 'TABLET',
    });
    expect(resolveMedicineTypeInput({ type: 'herbal' })).toEqual({ type: 'HERBAL' });
    expect(resolveMedicineTypeInput({ type: 'SYRUP', classification: 'CLASSICAL' })).toEqual({
      type: 'CLASSICAL',
      category: 'SYRUP',
    });
    expect(resolveMedicineTypeInput({ type: 'NOPE' })).toEqual({});
  });

  it('accepts both vocabularies and returns a clear 400 message for anything else', async () => {
    const base = {
      name: 'Para',
      manufacturer: 'Acme',
      quantity: 5,
      price: 10,
      expiryDate: '2027-01-01',
    };
    for (const type of ['TABLET', 'CLASSICAL']) {
      const dto = plainToInstance(CreateMedicineDto, { ...base, type });
      expect(await validate(dto)).toHaveLength(0);
    }
    const bad = await validate(plainToInstance(CreateMedicineDto, { ...base, type: 'BOGUS' }));
    expect(bad[0]?.constraints?.['isIn']).toContain('type must be one of');
  });

  it('allows a partial inventory update and rejects an invalid expiry', async () => {
    expect(
      await validate(plainToInstance(UpdateInventoryDto, { name: 'x', unit: 'strip' }))
    ).toEqual([]);
    const errors = await validate(plainToInstance(UpdateInventoryDto, { expiryDate: 'tomorrow' }));
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('PharmacyService inventory edit / soft delete', () => {
  it('edits the widened fields, maps type and writes an audit with the caller id', async () => {
    const h = createHarness();
    h.client['medicine']!['findUnique']!.mockResolvedValue(medicineRow());

    await h.service.updateInventory(
      'med-1',
      {
        name: ' Para 650 ',
        type: 'SYRUP',
        manufacturer: 'Acme',
        unit: 'bottle',
        price: 12.5,
        batchNumber: 'B1',
        expiryDate: '2027-12-31',
        minStockThreshold: 4,
        supplierId: 'sup-1',
        description: 'desc',
        instructions: 'after food',
        notes: 'n',
        quantityChange: 5,
      },
      CLINIC,
      PHARMACIST
    );

    const call = h.client['medicine']!['update']!.mock.calls[0]![0] as { data: Row };
    expect(call.data).toMatchObject({
      name: 'Para 650',
      type: 'PROPRIETARY',
      category: 'SYRUP',
      manufacturer: 'Acme',
      unit: 'bottle',
      price: 12.5,
      batchNumber: 'B1',
      minStockThreshold: 4,
      supplierId: 'sup-1',
      properties: 'desc',
      dosage: 'after food',
      notes: 'n',
      stock: { increment: 5 },
    });
    expect(call.data['expiryDate']).toEqual(new Date('2027-12-31'));
    const audit = h.databaseService.executeHealthcareWrite.mock.calls[0]![1] as Row;
    expect(audit).toMatchObject({ userId: 'pharm-user', clinicId: CLINIC, operation: 'UPDATE' });
    expect(h.cacheService.invalidateCacheByTag).toHaveBeenCalledWith('inventory');
  });

  it("reports another clinic's medicine as not found and never updates it", async () => {
    const h = createHarness();
    h.client['medicine']!['findUnique']!.mockResolvedValue(medicineRow({ clinicId: OTHER_CLINIC }));

    await expect(
      h.service.updateInventory('med-1', { price: 5 }, CLINIC, PHARMACIST)
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.client['medicine']!['update']).not.toHaveBeenCalled();
  });

  it('fails closed without a clinic, on an empty body, below-zero stock and a foreign supplier', async () => {
    const h = createHarness();
    h.client['medicine']!['findUnique']!.mockResolvedValue(medicineRow());

    await expect(h.service.updateInventory('med-1', { price: 5 })).rejects.toBeInstanceOf(
      BadRequestException
    );
    await expect(h.service.updateInventory('med-1', {}, CLINIC)).rejects.toThrow(
      'No editable fields'
    );
    await expect(
      h.service.updateInventory('med-1', { quantityChange: -11 }, CLINIC)
    ).rejects.toThrow('Stock cannot go below zero');
    h.client['supplier']!['findFirst']!.mockResolvedValue(null);
    await expect(
      h.service.updateInventory('med-1', { supplierId: 'sup-x' }, CLINIC)
    ).rejects.toThrow('Supplier does not belong to this clinic');
    expect(h.client['medicine']!['update']).not.toHaveBeenCalled();
  });

  it('rejects an unknown type with a 400 and keeps deactivated medicines read-only', async () => {
    const h = createHarness();
    h.client['medicine']!['findUnique']!.mockResolvedValue(medicineRow({ isActive: false }));
    await expect(h.service.updateInventory('med-1', { type: 'BOGUS' }, CLINIC)).rejects.toThrow(
      'Invalid medicine type'
    );
    await expect(h.service.updateInventory('med-1', { price: 3 }, CLINIC)).rejects.toThrow(
      'deactivated'
    );
  });

  it('soft deletes (isActive=false, deletedAt) and never hard deletes', async () => {
    const h = createHarness();
    h.client['medicine']!['findUnique']!.mockResolvedValue(medicineRow());
    h.client['prescriptionItem']!['count']!.mockResolvedValueOnce(0).mockResolvedValueOnce(3);

    const result = await h.service.deleteMedicine('med-1', CLINIC, PHARMACIST);

    expect(result).toMatchObject({ isActive: false, hasDispenseHistory: true });
    const data = (h.client['medicine']!['update']!.mock.calls[0]![0] as { data: Row }).data;
    expect(data['isActive']).toBe(false);
    expect(data['deletedAt']).toBeInstanceOf(Date);
    expect(h.client['medicine']!['delete']).toBeUndefined();
  });

  it('refuses to delete while an open prescription lists the medicine, and across clinics', async () => {
    const h = createHarness();
    h.client['medicine']!['findUnique']!.mockResolvedValue(medicineRow());
    h.client['prescriptionItem']!['count']!.mockResolvedValue(2);
    await expect(h.service.deleteMedicine('med-1', CLINIC, PHARMACIST)).rejects.toThrow(
      'open prescription'
    );
    expect(h.client['medicine']!['update']).not.toHaveBeenCalled();

    h.client['medicine']!['findUnique']!.mockResolvedValue(medicineRow({ clinicId: OTHER_CLINIC }));
    await expect(h.service.deleteMedicine('med-1', CLINIC, PHARMACIST)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('is idempotent for an already deleted medicine', async () => {
    const h = createHarness();
    h.client['medicine']!['findUnique']!.mockResolvedValue(medicineRow({ isActive: false }));
    const result = await h.service.deleteMedicine('med-1', CLINIC, PHARMACIST);
    expect(result).toMatchObject({ alreadyDeleted: true });
    expect(h.client['medicine']!['update']).not.toHaveBeenCalled();
  });

  it('creates a medicine from the web type vocabulary', async () => {
    const h = createHarness();
    await h.service.addMedicine(
      {
        name: 'Para',
        manufacturer: 'Acme',
        type: 'TABLET',
        quantity: 5,
        price: 10,
        expiryDate: '2027-01-01',
        unit: 'strip',
      },
      CLINIC,
      PHARMACIST
    );
    const data = (h.client['medicine']!['create']!.mock.calls[0]![0] as { data: Row }).data;
    expect(data).toMatchObject({
      type: 'PROPRIETARY',
      category: 'TABLET',
      unit: 'strip',
      stock: 5,
      clinicId: CLINIC,
    });
  });
});

describe('PharmacyService prescriptions', () => {
  it('buildPrescriptionNumber is deterministic and uses the IST day', () => {
    const rx = {
      id: 'aaaaaaaa-1111-2222-3333-444444444444',
      date: new Date('2026-10-04T20:00:00Z'),
    };
    expect(buildPrescriptionNumber(rx)).toBe('RX-20261005-AAAAAAAA');
    expect(buildPrescriptionNumber(rx)).toBe(buildPrescriptionNumber(rx));
  });

  it('createPrescription stores number + appointment link and validates medicines/appointment', async () => {
    const h = createHarness();
    h.client['medicine']!['findMany']!.mockResolvedValue([{ id: 'med-1' }]);
    h.client['appointment']!['findFirst']!.mockResolvedValue({
      id: 'appt-1',
      patientId: 'patient-1',
      doctorId: 'doctor-1',
    });

    await h.service.createPrescription(
      {
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        appointmentId: 'appt-1',
        items: [{ medicineId: 'med-1', quantity: 1 }],
      },
      CLINIC,
      DOCTOR
    );

    const data = (h.client['prescription']!['create']!.mock.calls[0]![0] as { data: Row }).data;
    expect(data['appointmentId']).toBe('appt-1');
    expect(data['prescriptionNumber']).toBe(
      buildPrescriptionNumber({ id: String(data['id']), date: data['date'] as Date })
    );
  });

  it('createPrescription rejects foreign/inactive medicines and a mismatching appointment', async () => {
    const h = createHarness();
    h.client['medicine']!['findMany']!.mockResolvedValue([]);
    await expect(
      h.service.createPrescription(
        { patientId: 'p', doctorId: 'd', items: [{ medicineId: 'med-x', quantity: 1 }] },
        CLINIC
      )
    ).rejects.toThrow('not part of this clinic inventory');

    h.client['medicine']!['findMany']!.mockResolvedValue([{ id: 'med-1' }]);
    h.client['appointment']!['findFirst']!.mockResolvedValue({
      id: 'appt-1',
      patientId: 'someone-else',
      doctorId: 'd',
    });
    await expect(
      h.service.createPrescription(
        {
          patientId: 'p',
          doctorId: 'd',
          appointmentId: 'appt-1',
          items: [{ medicineId: 'med-1', quantity: 1 }],
        },
        CLINIC
      )
    ).rejects.toThrow('Appointment does not match');
    expect(h.client['prescription']!['create']).not.toHaveBeenCalled();
  });

  describe('doctor edit', () => {
    function harnessWithRx(rx: Row = prescriptionRow()) {
      const h = createHarness();
      h.client['prescription']!['findUnique']!.mockResolvedValue(rx);
      h.client['medicine']!['findMany']!.mockResolvedValue([{ id: 'med-1' }]);
      return h;
    }
    const dto = { items: [{ medicineId: 'med-1', quantity: 3, dosage: '2 tab' }], notes: 'rest' };

    it('lets the prescribing doctor replace items, notes and writes an audit entry', async () => {
      const h = harnessWithRx();
      await h.service.updatePrescriptionByDoctor('rx-1', dto, CLINIC, DOCTOR);

      expect(h.client['prescriptionItem']!['deleteMany']).toHaveBeenCalledWith({
        where: { prescriptionId: 'rx-1' },
      });
      const update = h.client['prescription']!['update']!.mock.calls[0]![0] as {
        data: { notes: string; items: { create: Array<Row> } };
      };
      expect(update.data.notes).toBe('rest');
      expect(update.data.items.create[0]).toMatchObject({
        medicineId: 'med-1',
        quantity: 3,
        dosage: '2 tab',
        clinicId: CLINIC,
      });
      const audit = h.client['auditLog']!['create']!.mock.calls[0]![0] as { data: Row };
      expect(audit.data).toMatchObject({
        userId: 'doc-user',
        action: 'PRESCRIPTION_EDITED',
        resourceId: 'rx-1',
      });
    });

    it('refuses another doctor, a dispensed/cancelled prescription and another clinic', async () => {
      await expect(
        harnessWithRx().service.updatePrescriptionByDoctor('rx-1', dto, CLINIC, {
          userId: 'other-doc',
          role: 'DOCTOR',
        })
      ).rejects.toBeInstanceOf(ForbiddenException);

      for (const status of ['PARTIAL', 'FILLED', 'CANCELLED']) {
        await expect(
          harnessWithRx(prescriptionRow({ status })).service.updatePrescriptionByDoctor(
            'rx-1',
            dto,
            CLINIC,
            DOCTOR
          )
        ).rejects.toThrow('can be edited');
      }
      await expect(
        harnessWithRx(
          prescriptionRow({ clinicId: OTHER_CLINIC })
        ).service.updatePrescriptionByDoctor('rx-1', dto, CLINIC, DOCTOR)
      ).rejects.toThrow('does not belong to this clinic');
    });

    it('blocks item changes once billing started but still allows notes', async () => {
      const h = harnessWithRx();
      h.billing.findPrescriptionInvoices.mockResolvedValue(new Map([['rx-1', { id: 'inv-1' }]]));
      await expect(
        h.service.updatePrescriptionByDoctor('rx-1', dto, CLINIC, DOCTOR)
      ).rejects.toThrow('billing has started');
      expect(h.client['prescriptionItem']!['deleteMany']).not.toHaveBeenCalled();

      await h.service.updatePrescriptionByDoctor('rx-1', { notes: 'only notes' }, CLINIC, DOCTOR);
      expect(h.client['prescription']!['update']).toHaveBeenCalled();
    });

    it('requires clinic context and at least one field', async () => {
      const h = harnessWithRx();
      await expect(
        h.service.updatePrescriptionByDoctor('rx-1', dto, undefined, DOCTOR)
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        h.service.updatePrescriptionByDoctor('rx-1', {}, CLINIC, DOCTOR)
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('adds number, appointment id, pdf link, age, gender, patient number, visit type and unit', async () => {
    const h = createHarness();
    h.client['prescription']!['findUnique']!.mockResolvedValue(prescriptionRow());
    h.client['appointment']!['findMany']!.mockResolvedValue([{ id: 'appt-1', type: 'IN_PERSON' }]);
    h.client['patientVisit']!['findMany']!.mockResolvedValue([
      { id: 'visit-1', opdNumber: 'OPD-7' },
    ]);

    const result = (await h.service.findPrescriptionById('rx-1', CLINIC, {
      userId: 'pharm-user',
      role: 'PHARMACIST',
    })) as unknown as {
      prescriptionNumber: string;
      appointmentId: string;
      pdfUrl: string;
      patientAge: number;
      patientGender: string;
      patientNumber: string;
      visitType: string;
      items: Array<{ medicineUnit: string }>;
    };

    expect(result.prescriptionNumber).toBe('RX-20261005-AAAAAAAA');
    expect(result.appointmentId).toBe('appt-1');
    expect(result.pdfUrl).toBe('/pharmacy/prescriptions/aaaaaaaa-1111-2222-3333-444444444444/pdf');
    expect(result.patientAge).toBe(40);
    expect(result.patientGender).toBe('FEMALE');
    expect(result.patientNumber).toBe('OPD-7');
    expect(result.visitType).toBe('IN_PERSON');
    expect(result.items[0]!.medicineUnit).toBe('strip');
  });

  it('shows who dispensed and the batch/expiry on desk items', async () => {
    const h = createHarness();
    h.client['prescription']!['findUnique']!.mockResolvedValue(
      prescriptionRow({
        status: 'FILLED',
        items: [
          {
            id: 'item-1',
            quantity: 2,
            dispensedQuantity: 2,
            medicineId: 'med-1',
            dispensedAt: new Date('2026-10-05T05:00:00Z'),
            dispensedBatchNumber: 'B-9',
            dispensedBatchExpiryDate: new Date('2027-01-01T00:00:00Z'),
            dispenseEventHistory: [
              {
                quantity: 2,
                batchNumber: 'B-9',
                eventType: 'DISPENSE',
                dispensedAt: '2026-10-05T05:00:00.000Z',
                dispensedById: 'pharm-user',
                dispensedByName: 'Pharma Cist',
              },
            ],
            medicine: { name: 'Para', price: 10, unit: 'strip' },
          },
        ],
      })
    );
    const result = (await h.service.findPrescriptionById('rx-1', CLINIC, {
      userId: 'pharm-user',
      role: 'PHARMACIST',
    })) as unknown as {
      dispensedBy: string;
      dispensedById: string;
      items: Array<{ batchNumber: string; dispensedByName: string }>;
    };
    expect(result.dispensedBy).toBe('Pharma Cist');
    expect(result.dispensedById).toBe('pharm-user');
    expect(result.items[0]).toMatchObject({ batchNumber: 'B-9', dispensedByName: 'Pharma Cist' });
  });
});

describe('PharmacyService.getPrescriptionPdf access', () => {
  function harness() {
    const h = createHarness();
    h.client['prescription']!['findUnique']!.mockResolvedValue(prescriptionRow());
    return h;
  }

  it('returns a PDF for the prescribing doctor and the clinic pharmacist', async () => {
    const h = harness();
    const doctorPdf = await h.service.getPrescriptionPdf('rx-1', CLINIC, DOCTOR);
    expect(doctorPdf.buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(doctorPdf.fileName).toBe('prescription-RX-20261005-AAAAAAAA.pdf');
    const pharmacistPdf = await h.service.getPrescriptionPdf('rx-1', CLINIC, PHARMACIST);
    expect(pharmacistPdf.buffer.length).toBeGreaterThan(100);
  });

  it('refuses another doctor, other roles and staff without a clinic', async () => {
    const h = harness();
    await expect(
      h.service.getPrescriptionPdf('rx-1', CLINIC, { userId: 'other-doc', role: 'DOCTOR' })
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      h.service.getPrescriptionPdf('rx-1', CLINIC, { userId: 'rec', role: 'RECEPTIONIST' })
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      h.service.getPrescriptionPdf('rx-1', undefined, PHARMACIST)
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.getPrescriptionPdf('rx-1', OTHER_CLINIC, PHARMACIST)).rejects.toThrow(
      'does not belong to this clinic'
    );
  });

  it('lets only the owner patient download, a stranger gets 404', async () => {
    const h = harness();
    h.client['patient']!['findFirst'] = jest.fn().mockResolvedValue(null);
    h.client['familyMember'] = { findMany: jest.fn().mockResolvedValue([]) };
    const owner = await h.service.getPrescriptionPdf('rx-1', CLINIC, {
      userId: 'patient-user',
      role: 'PATIENT',
    });
    expect(owner.buffer.length).toBeGreaterThan(100);
    await expect(
      h.service.getPrescriptionPdf('rx-1', CLINIC, { userId: 'stranger', role: 'PATIENT' })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('batch audit dates', () => {
  it('resolveAuditDateBound makes the To day inclusive in IST', () => {
    const endOfDay = resolveAuditDateBound('2026-05-31', 'end') as number;
    expect(new Date(endOfDay).toISOString()).toBe('2026-05-31T18:29:59.999Z');
    expect(new Date(resolveAuditDateBound('2026-05-31', 'start') as number).toISOString()).toBe(
      '2026-05-30T18:30:00.000Z'
    );
    // a date picker's UTC-midnight ISO and IST-midnight ISO both mean "that day"
    expect(resolveAuditDateBound('2026-05-31T00:00:00.000Z', 'end')).toBe(endOfDay);
    expect(resolveAuditDateBound('2026-05-30T18:30:00.000Z', 'end')).toBe(endOfDay);
    // a precise timestamp is untouched; junk and empty give null
    const precise = new Date('2026-05-31T10:15:00.000Z').getTime();
    expect(resolveAuditDateBound('2026-05-31T10:15:00.000Z', 'end')).toBe(precise);
    expect(resolveAuditDateBound('nonsense', 'end')).toBeNull();
    expect(resolveAuditDateBound(undefined, 'start')).toBeNull();
  });

  function auditHarness() {
    const h = createHarness();
    const item = {
      id: 'item-1',
      medicineId: 'med-1',
      medicine: { name: 'Para' },
      dispenseEventHistory: [
        {
          quantity: 2,
          batchNumber: 'B1',
          eventType: 'DISPENSE',
          medicineId: 'med-1',
          dispensedAt: '2026-05-10T05:00:00.000Z',
          reversedAt: '2026-05-31T09:00:00.000Z',
          reversalReason: 'wrong batch',
          dispensedById: 'pharm-user',
          dispensedByName: 'Pharma Cist',
        },
        {
          quantity: 2,
          eventType: 'REVERSAL',
          medicineId: 'med-1',
          dispensedAt: '2026-05-31T09:00:00.000Z',
          reversedAt: '2026-05-31T09:00:00.000Z',
          reversalReason: 'wrong batch',
        },
      ],
    };
    h.client['prescription']!['findMany']!.mockResolvedValue([
      {
        id: 'rx-1',
        clinicId: CLINIC,
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        patient: { user: { name: 'Pat' } },
        doctor: { user: { name: 'Doc' } },
        items: [item],
      },
    ]);
    h.client['medicine']!['findMany']!.mockResolvedValue([{ id: 'med-1', name: 'Para' }]);
    return h;
  }

  it('lists a reversed dispense at its original time and the reversal separately', async () => {
    const h = auditHarness();
    const entries = await h.service.getPharmacyBatchAudit(CLINIC, {});
    const dispense = entries.find(entry => entry.eventType === 'DISPENSE')!;
    const reversal = entries.find(entry => entry.eventType === 'REVERSAL')!;
    expect(dispense.eventAt).toBe('2026-05-10T05:00:00.000Z');
    expect(dispense.reversedAt).toBe('2026-05-31T09:00:00.000Z');
    expect(dispense.dispensedByName).toBe('Pharma Cist');
    expect(reversal.eventAt).toBe('2026-05-31T09:00:00.000Z');
  });

  it('includes events on the whole To day (IST) and filters by the original time', async () => {
    const h = auditHarness();
    const inclusive = await h.service.getPharmacyBatchAudit(CLINIC, {
      startDate: '2026-05-31',
      endDate: '2026-05-31',
    });
    // reversal at 09:00Z on the 31st is inside the IST day; the 10 May dispense is not
    expect(inclusive.map(entry => entry.eventType)).toEqual(['REVERSAL']);

    const may10 = await h.service.getPharmacyBatchAudit(CLINIC, {
      startDate: '2026-05-10',
      endDate: '2026-05-10',
    });
    expect(may10.map(entry => entry.eventType)).toEqual(['DISPENSE']);
  });
});
