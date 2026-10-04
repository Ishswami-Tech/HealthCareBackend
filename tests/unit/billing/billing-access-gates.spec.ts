/// <reference types="jest" />
/**
 * Ownership / clinic gates on id-taking billing routes:
 *  - GET appointments/:id/payout-status: only billing/admin roles of that clinic and the
 *    TREATING doctor (never a patient or another doctor);
 *  - GET invoices/download/:fileName: the invoice is resolved from the file name and run through
 *    the same ownership check;
 *  - GET subscriptions/user/:id/active: the guard-validated clinic wins over ?clinicId;
 *  - POST payments is staff-only and pinned to the guard clinic.
 */

jest.mock('@payment/payment.service', () => ({ PaymentService: class {} }), { virtual: true });
jest.mock(
  '@payment/payment.handoff-token.service',
  () => ({ PaymentHandoffTokenService: class {} }),
  { virtual: true }
);
jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));
jest.mock('@core/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));
jest.mock('@core/guards/roles.guard', () => ({ RolesGuard: class {} }));
jest.mock('@core/guards/clinic.guard', () => ({ ClinicGuard: class {} }));
jest.mock('@core/guards/profile-completion.guard', () => ({ ProfileCompletionGuard: class {} }));
jest.mock('@core/rbac/rbac.guard', () => ({ RbacGuard: class {} }));
jest.mock('@queue/src/queue.service', () => ({ QueueService: class {} }));
jest.mock('@services/billing/invoice-pdf.service', () => ({ InvoicePDFService: class {} }));

import { NotFoundException } from '@nestjs/common';
import { createBillingService } from './billing-test-harness';
import type { MockMap } from './billing-test-harness';
import { FakeBillingDb } from './billing-fake-db';
import { CLINIC_ID } from './billing-finalisation-world';
import { BillingController } from '@services/billing/controllers/billing.controller';
import { Role } from '@core/types/enums.types';

const CLINIC_OTHER = 'clinic-other';

function rolesOf(method: keyof BillingController): string[] {
  const handler = BillingController.prototype[method] as unknown as object;
  return (Reflect.getMetadata('roles', handler) as string[] | undefined) ?? [];
}

describe('GET appointments/:id/payout-status', () => {
  function setup() {
    const db = new FakeBillingDb();
    db.seed('appointment', {
      id: 'apt-1',
      clinicId: CLINIC_ID,
      doctorId: 'doctor-1',
      doctor: { userId: 'doctor-user' },
      patient: { userId: 'patient-user' },
    });
    db.seed('payment', {
      id: 'pay-1',
      clinicId: CLINIC_ID,
      appointmentId: 'apt-1',
      status: 'COMPLETED',
      createdAt: new Date(),
      metadata: { payout: { state: 'PAYOUT_PENDING', doctorShareAmount: 900 } },
    });
    return createBillingService({ databaseService: db.service as unknown as MockMap });
  }

  it.each(['SUPER_ADMIN', 'CLINIC_ADMIN', 'FINANCE_BILLING'])(
    'lets %s of the clinic read it',
    async role => {
      const { service } = setup();

      await expect(
        service.getAppointmentPayoutStatus('apt-1', CLINIC_ID, {
          userId: 'staff',
          role,
          clinicId: CLINIC_ID,
        })
      ).resolves.toMatchObject({ paymentId: 'pay-1', payoutState: 'PAYOUT_PENDING' });
    }
  );

  it('lets the TREATING doctor read it', async () => {
    const { service } = setup();

    await expect(
      service.getAppointmentPayoutStatus('apt-1', CLINIC_ID, {
        userId: 'doctor-user',
        role: 'DOCTOR',
        clinicId: CLINIC_ID,
      })
    ).resolves.toMatchObject({ paymentId: 'pay-1' });
  });

  it.each([
    ['PATIENT', 'patient-user'],
    ['RECEPTIONIST', 'recep'],
    ['DOCTOR', 'another-doctor-user'],
  ])('refuses a %s who is not the treating doctor / billing staff', async (role, userId) => {
    const { service } = setup();

    await expect(
      service.getAppointmentPayoutStatus('apt-1', CLINIC_ID, { userId, role, clinicId: CLINIC_ID })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses another clinic outright', async () => {
    const { service } = setup();

    await expect(
      service.getAppointmentPayoutStatus('apt-1', CLINIC_OTHER, {
        userId: 'admin',
        role: 'CLINIC_ADMIN',
        clinicId: CLINIC_OTHER,
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the route no longer lists PATIENT or RECEPTIONIST', () => {
    const roles = rolesOf('getAppointmentPayoutStatus');
    expect(roles).not.toContain(Role.PATIENT);
    expect(roles).not.toContain(Role.RECEPTIONIST);
    expect(roles).toEqual(
      expect.arrayContaining([
        Role.SUPER_ADMIN,
        Role.CLINIC_ADMIN,
        Role.FINANCE_BILLING,
        Role.DOCTOR,
      ])
    );
  });
});

describe('GET invoices/download/:fileName', () => {
  function setup() {
    const db = new FakeBillingDb();
    db.seed('invoice', {
      id: 'inv-1',
      invoiceNumber: 'INV-2026-000001',
      userId: 'patient-a',
      clinicId: CLINIC_ID,
    });
    return createBillingService({ databaseService: db.service as unknown as MockMap });
  }

  const OWNER = { userId: 'patient-a', role: 'PATIENT', clinicId: CLINIC_ID };

  it.each([
    'invoice_INV-2026-000001_1759500000000.pdf', // pre-existing guessable name
    'invoice_INV-2026-000001_1759500000000-0123456789abcdef.pdf', // unguessable suffix
  ])('lets the invoice owner download %s', async fileName => {
    const { service } = setup();

    await expect(service.assertInvoiceFileAccess(fileName, OWNER)).resolves.toBeUndefined();
  });

  it('lets staff of the invoice clinic download it', async () => {
    const { service } = setup();

    await expect(
      service.assertInvoiceFileAccess('invoice_INV-2026-000001_1759500000000.pdf', {
        userId: 'staff',
        role: 'RECEPTIONIST',
        clinicId: CLINIC_ID,
      })
    ).resolves.toBeUndefined();
  });

  it("refuses another patient and another clinic's staff", async () => {
    const { service } = setup();
    const fileName = 'invoice_INV-2026-000001_1759500000000.pdf';

    await expect(
      service.assertInvoiceFileAccess(fileName, {
        userId: 'patient-b',
        role: 'PATIENT',
        clinicId: CLINIC_ID,
      })
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.assertInvoiceFileAccess(fileName, {
        userId: 'staff',
        role: 'CLINIC_ADMIN',
        clinicId: CLINIC_OTHER,
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each(['../../etc/passwd', 'not-an-invoice.pdf', 'invoice_INV-2099-000009_1.pdf'])(
    'answers 404 for %s',
    async fileName => {
      const { service } = setup();

      await expect(service.assertInvoiceFileAccess(fileName, OWNER)).rejects.toBeInstanceOf(
        NotFoundException
      );
    }
  );
});

describe('BillingService.getActiveUserSubscription clinic scoping', () => {
  function setup() {
    const db = new FakeBillingDb();
    db.seed('billingPlan', { id: 'plan-1', name: 'Gold', amount: 100, clinicId: CLINIC_ID });
    for (const [id, clinicId] of [
      ['sub-a', CLINIC_ID],
      ['sub-b', CLINIC_OTHER],
    ] as const) {
      db.seed('subscription', {
        id,
        userId: 'patient-a',
        clinicId,
        planId: 'plan-1',
        status: 'ACTIVE',
        currentPeriodEnd: new Date(Date.now() + 10 * 24 * 3600 * 1000),
        createdAt: new Date(),
      });
    }
    return createBillingService({ databaseService: db.service as unknown as MockMap });
  }

  it("a clinic's staff only ever sees subscriptions of THEIR clinic, whatever ?clinicId says", async () => {
    const { service } = setup();

    const result = await service.getActiveUserSubscription('patient-a', CLINIC_OTHER, {
      userId: 'staff',
      role: 'CLINIC_ADMIN',
      clinicId: CLINIC_ID,
    });

    expect(result?.id).toBe('sub-a');
  });

  it('SUPER_ADMIN may name any clinic', async () => {
    const { service } = setup();

    const result = await service.getActiveUserSubscription('patient-a', CLINIC_OTHER, {
      userId: 'root',
      role: 'SUPER_ADMIN',
    });

    expect(result?.id).toBe('sub-b');
  });
});

describe('BillingController', () => {
  function controllerWith(billingService: Record<string, jest.Mock>): BillingController {
    return new BillingController(billingService as never, {} as never, {} as never, {} as never);
  }

  const request = (role: string, clinicId?: string) =>
    ({
      user: { sub: 'user-1', role },
      ...(clinicId ? { clinicContext: { clinicId } } : {}),
    }) as never;

  it('the guard-validated clinic wins over the ?clinicId query on the active subscription route', async () => {
    const getActiveUserSubscription = jest.fn().mockResolvedValue(undefined);
    const controller = controllerWith({ getActiveUserSubscription });

    await controller.getActiveUserSubscription(
      'user-1',
      CLINIC_OTHER,
      request('CLINIC_ADMIN', CLINIC_ID)
    );

    expect(getActiveUserSubscription).toHaveBeenCalledWith(
      'user-1',
      CLINIC_ID,
      expect.objectContaining({ clinicId: CLINIC_ID, role: 'CLINIC_ADMIN' })
    );
  });

  it('POST /billing/payments is staff only: PATIENT is not a permitted role', () => {
    const roles = rolesOf('createPayment');

    expect(roles).not.toContain(Role.PATIENT);
    expect(roles).toEqual(
      expect.arrayContaining([
        Role.SUPER_ADMIN,
        Role.CLINIC_ADMIN,
        Role.RECEPTIONIST,
        Role.FINANCE_BILLING,
      ])
    );
  });

  it('POST /billing/payments pins a non-super-admin to the guard clinic', async () => {
    const createPayment = jest.fn().mockResolvedValue({ id: 'pay-1' });
    const controller = controllerWith({ createPayment });

    await controller.createPayment(
      { amount: 10, clinicId: CLINIC_OTHER, invoiceId: 'inv-1' } as never,
      request('FINANCE_BILLING', CLINIC_ID)
    );

    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: CLINIC_ID, invoiceId: 'inv-1' }),
      expect.objectContaining({ clinicId: CLINIC_ID, role: 'FINANCE_BILLING' })
    );
  });

  it('plan routes pass the requester so the service can scope by clinic', async () => {
    const getBillingPlan = jest.fn().mockResolvedValue({});
    const updateBillingPlan = jest.fn().mockResolvedValue({});
    const deleteBillingPlan = jest.fn().mockResolvedValue(undefined);
    const controller = controllerWith({ getBillingPlan, updateBillingPlan, deleteBillingPlan });
    const req = request('CLINIC_ADMIN', CLINIC_ID);
    const requester = expect.objectContaining({ clinicId: CLINIC_ID, role: 'CLINIC_ADMIN' });

    await controller.getBillingPlan('plan-1', req);
    await controller.updateBillingPlan('plan-1', {} as never, req);
    await controller.deleteBillingPlan('plan-1', req);

    expect(getBillingPlan).toHaveBeenCalledWith('plan-1', requester);
    expect(updateBillingPlan).toHaveBeenCalledWith('plan-1', {}, requester);
    expect(deleteBillingPlan).toHaveBeenCalledWith('plan-1', requester);
  });
});

describe('Pharmacist clinic invoices / payments scope', () => {
  const pharmacyInvoice = { id: 'inv-ph', clinicId: CLINIC_ID, billType: 'PHARMACY' };
  const rxInvoice = {
    id: 'inv-rx',
    clinicId: CLINIC_ID,
    billType: 'OTHER',
    prescriptionId: 'rx-1',
  };
  const apptInvoice = { id: 'inv-ap', clinicId: CLINIC_ID, billType: 'APPOINTMENT' };
  const subInvoice = { id: 'inv-sub', clinicId: CLINIC_ID, billType: 'SUBSCRIPTION' };

  function setup() {
    const findInvoicesSafe = jest
      .fn()
      .mockResolvedValue([pharmacyInvoice, rxInvoice, apptInvoice, subInvoice]);
    const findPaymentsSafe = jest.fn().mockResolvedValue([
      { id: 'p-ph', clinicId: CLINIC_ID, invoice: pharmacyInvoice, metadata: {} },
      { id: 'p-ap', clinicId: CLINIC_ID, appointmentId: 'apt-1', invoice: apptInvoice },
      { id: 'p-sub', clinicId: CLINIC_ID, subscriptionId: 'sub-1', invoice: pharmacyInvoice },
      { id: 'p-orphan', clinicId: CLINIC_ID, metadata: {} },
    ]);
    const { service } = createBillingService({
      databaseService: { findInvoicesSafe, findPaymentsSafe } as unknown as MockMap,
    });
    return { service, findInvoicesSafe, findPaymentsSafe };
  }

  it('allows PHARMACIST on both clinic routes', () => {
    expect(rolesOf('getClinicInvoices')).toContain(Role.PHARMACIST);
    expect(rolesOf('getClinicPayments')).toContain(Role.PHARMACIST);
  });

  it('PHARMACIST only sees pharmacy / prescription invoices', async () => {
    const { service } = setup();
    const result = await service.getClinicInvoices(CLINIC_ID, 'PHARMACIST');
    expect((result as Array<{ id: string }>).map(i => i.id)).toEqual(['inv-ph', 'inv-rx']);
  });

  it('PHARMACIST only sees pharmacy invoice payments (no appointment, subscription or orphan rows)', async () => {
    const { service } = setup();
    const result = await service.getClinicPayments(CLINIC_ID, undefined, 'PHARMACIST');
    expect(result.map(p => p.id)).toEqual(['p-ph']);
  });

  it('other roles are unfiltered', async () => {
    const { service } = setup();
    expect(await service.getClinicInvoices(CLINIC_ID, 'CLINIC_ADMIN')).toHaveLength(4);
    expect(await service.getClinicPayments(CLINIC_ID, undefined, 'CLINIC_ADMIN')).toHaveLength(4);
  });

  it('keeps the pharmacist invoice cache entry apart from the full clinic one', async () => {
    const keys: string[] = [];
    const { service } = createBillingService({
      databaseService: { findInvoicesSafe: jest.fn().mockResolvedValue([]) } as unknown as MockMap,
      cacheService: {
        cache: jest.fn(async (key: string, loader: () => Promise<unknown>) => {
          keys.push(key);
          return loader();
        }),
        invalidateCacheByTag: jest.fn(),
      },
    });
    await service.getClinicInvoices(CLINIC_ID, 'PHARMACIST');
    await service.getClinicInvoices(CLINIC_ID, 'CLINIC_ADMIN');
    expect(new Set(keys).size).toBe(2);
  });
});

describe('Insurance claims: patient self access', () => {
  const OWN_PATIENT = 'patient-own';
  const dto = {
    patientId: OWN_PATIENT,
    clinicId: CLINIC_OTHER,
    claimNumber: 'CLM-1',
    provider: 'Acme',
    amount: 100,
  };

  function setup(opts: { ownPatientId?: string | null; linkFound?: boolean } = {}) {
    const claimCreate = jest.fn().mockResolvedValue({ id: 'claim-1' });
    const claimFindMany = jest.fn().mockResolvedValue([]);
    const client = {
      patient: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.ownPatientId === null ? null : { id: opts.ownPatientId ?? OWN_PATIENT }
          ),
      },
      appointment: {
        findFirst: jest.fn().mockResolvedValue(opts.linkFound === false ? null : { id: 'apt-1' }),
      },
      invoice: {
        findFirst: jest.fn().mockResolvedValue(opts.linkFound === false ? null : { id: 'inv-1' }),
      },
      insuranceClaim: { create: claimCreate, findMany: claimFindMany },
    };
    const executeHealthcareRead = jest.fn(async (fn: (c: unknown) => unknown) => fn(client));
    const executeHealthcareWrite = jest.fn(async (fn: (c: unknown) => unknown) => fn(client));
    const { service } = createBillingService({
      databaseService: { executeHealthcareRead, executeHealthcareWrite } as unknown as MockMap,
    });
    return { service, claimCreate, claimFindMany, client };
  }

  const patient = { userId: 'user-1', role: 'PATIENT', clinicId: CLINIC_ID };

  it('the routes allow PATIENT on create and list only', () => {
    expect(rolesOf('createInsuranceClaim')).toContain(Role.PATIENT);
    expect(rolesOf('getInsuranceClaims')).toContain(Role.PATIENT);
    expect(rolesOf('updateInsuranceClaim')).not.toContain(Role.PATIENT);
    expect(rolesOf('deleteInsuranceClaim')).not.toContain(Role.PATIENT);
  });

  it('files the claim for the patient own profile and pins the guard clinic', async () => {
    const { service, claimCreate } = setup();
    await service.createInsuranceClaim(dto as never, patient);
    expect(claimCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patientId: OWN_PATIENT,
        clinicId: CLINIC_ID,
        status: 'SUBMITTED',
      }),
    });
  });

  it('rejects a claim for another patient profile', async () => {
    const { service, claimCreate } = setup({ ownPatientId: 'someone-else' });
    await expect(service.createInsuranceClaim(dto as never, patient)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(claimCreate).not.toHaveBeenCalled();
  });

  it('rejects a patient without a patient profile', async () => {
    const { service, claimCreate } = setup({ ownPatientId: null });
    await expect(service.createInsuranceClaim(dto as never, patient)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(claimCreate).not.toHaveBeenCalled();
  });

  it('rejects a claim linked to an appointment or invoice that is not the patient own', async () => {
    const { service, claimCreate } = setup({ linkFound: false });
    await expect(
      service.createInsuranceClaim({ ...dto, appointmentId: 'apt-x' } as never, patient)
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(claimCreate).not.toHaveBeenCalled();
  });

  it('a patient only lists their own claims; no profile means no claims', async () => {
    const own = setup();
    await own.service.getInsuranceClaims(CLINIC_ID, patient);
    expect(own.claimFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clinicId: CLINIC_ID, patientId: OWN_PATIENT } })
    );

    const none = setup({ ownPatientId: null });
    await expect(none.service.getInsuranceClaims(CLINIC_ID, patient)).resolves.toEqual([]);
    expect(none.claimFindMany).not.toHaveBeenCalled();
  });

  it('staff listing stays clinic wide', async () => {
    const { service, claimFindMany } = setup();
    await service.getInsuranceClaims(CLINIC_ID, {
      userId: 's',
      role: 'CLINIC_ADMIN',
      clinicId: CLINIC_ID,
    });
    expect(claimFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clinicId: CLINIC_ID } })
    );
  });

  it('staff cannot file a claim for a patient outside the clinic', async () => {
    const { service, claimCreate, client } = setup();
    client.patient.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.createInsuranceClaim(dto as never, {
        userId: 's',
        role: 'CLINIC_ADMIN',
        clinicId: CLINIC_ID,
      })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(claimCreate).not.toHaveBeenCalled();
  });
});
