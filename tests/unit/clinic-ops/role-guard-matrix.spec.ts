/**
 * Role guard matrix (product rules V2/V3): who may call the key endpoints, read straight from the
 * real controllers' @Roles metadata and run through the real RolesGuard, plus the server-side
 * billing-amount (doctor / assistant) and clinical-field (reception) redaction.
 *
 * Roles under test: PATIENT, RECEPTIONIST, ASSISTANT_DOCTOR, DOCTOR, CLINIC_ADMIN, PHARMACIST.
 */
import { describe, expect, it } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { RolesGuard } from '@core/guards/roles.guard';
import { ROLES_KEY } from '@core/decorators/roles.decorator';
import { BillingRedactionInterceptor } from '@core/interceptors/billing-redaction.interceptor';
import { ReceptionClinicalRedactionInterceptor } from '@core/interceptors/clinical-redaction.interceptor';
import { canControlVisit } from '@core/rbac/visit-authority.util';
import { assertReceptionMayBook } from '@services/appointments/core/booking-policy.util';
import { AppointmentsController } from '@services/appointments/appointments.controller';
import { InPersonController } from '@services/appointments/in-person/in-person.controller';
import { QueueController } from '@infrastructure/queue/src/controllers/queue.controller';
import { PharmacyController } from '@services/pharmacy/controllers/pharmacy.controller';
import { BillingController } from '@services/billing/controllers/billing.controller';
import { ClinicLocationController } from '@services/clinic/cliniclocation/clinic-location.controller';
import { PatientDirectoryController } from '@services/patient-directory/patient-directory.controller';
import { PatientsController } from '@services/patients/controllers/patients.controller';
import {
  DirectDispenseController,
  RxDraftController,
} from '@services/clinic-ops/controllers/clinical-ops.controller';
import {
  BillingOpsController,
  StaffAdminController,
} from '@services/clinic-ops/controllers/admin-ops.controller';
import { PharmacyOpsController } from '@services/clinic-ops/controllers/extra-ops.controller';
import { CheckInLogController } from '@services/clinic-ops/controllers/front-desk.controller';

const ROLES = [
  'PATIENT',
  'RECEPTIONIST',
  'ASSISTANT_DOCTOR',
  'DOCTOR',
  'CLINIC_ADMIN',
  'PHARMACIST',
] as const;
type TestRole = (typeof ROLES)[number];

type AnyController = abstract new (...args: never[]) => object;

const guard = new RolesGuard(new Reflector());

function contextFor(
  controller: AnyController,
  method: string,
  role: string,
  type: 'http' | 'ws' = 'http'
): ExecutionContext {
  const handler = (controller.prototype as Record<string, unknown>)[method];
  if (typeof handler !== 'function') {
    throw new Error(`${controller.name}.${method} does not exist`);
  }
  return {
    getHandler: () => handler,
    getClass: () => controller,
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
  } as unknown as ExecutionContext;
}

function allowedRoles(controller: AnyController, method: string): TestRole[] {
  return ROLES.filter(role => guard.canActivate(contextFor(controller, method, role)));
}

/** [endpoint, controller, handler, roles (of the six) that must get through] */
const MATRIX: Array<[string, AnyController, string, TestRole[]]> = [
  // booking / arrival
  [
    'POST /appointments (book)',
    AppointmentsController,
    'createAppointment',
    ['PATIENT', 'RECEPTIONIST', 'DOCTOR', 'CLINIC_ADMIN'],
  ],
  [
    'POST /appointments/check-in/scan-qr',
    AppointmentsController,
    'scanLocationQRAndCheckIn',
    ['PATIENT'],
  ],
  [
    'POST /in-person/check-in (QR or desk one-click)',
    InPersonController,
    'checkIn',
    ['PATIENT', 'RECEPTIONIST', 'CLINIC_ADMIN'],
  ],
  [
    'POST /appointments/:id/check-in (desk)',
    AppointmentsController,
    'checkInAppointment',
    ['RECEPTIONIST', 'CLINIC_ADMIN'],
  ],
  ['GET /in-person/desk', InPersonController, 'desk', ['RECEPTIONIST', 'CLINIC_ADMIN']],
  ['POST /in-person/walk-in', InPersonController, 'walkIn', ['RECEPTIONIST', 'CLINIC_ADMIN']],
  [
    'POST /appointments/:id/mark-no-show',
    AppointmentsController,
    'markNoShow',
    ['RECEPTIONIST', 'ASSISTANT_DOCTOR', 'DOCTOR', 'CLINIC_ADMIN'],
  ],
  [
    'POST /in-person/appointments/:id/undo-no-show',
    InPersonController,
    'undoNoShow',
    ['RECEPTIONIST', 'ASSISTANT_DOCTOR', 'DOCTOR', 'CLINIC_ADMIN'],
  ],
  // queue
  [
    'GET /queue',
    QueueController,
    'listQueue',
    ['PATIENT', 'RECEPTIONIST', 'ASSISTANT_DOCTOR', 'DOCTOR', 'CLINIC_ADMIN'],
  ],
  ['POST /queue/call-next', QueueController, 'callNext', ['DOCTOR']],
  ['POST /appointments/:id/complete', AppointmentsController, 'completeAppointment', ['DOCTOR']],
  // prescriptions
  [
    'POST /pharmacy/prescriptions (assistant -> DRAFT)',
    PharmacyController,
    'createPrescription',
    ['ASSISTANT_DOCTOR', 'DOCTOR'],
  ],
  ['GET /rx-drafts', RxDraftController, 'list', ['ASSISTANT_DOCTOR', 'DOCTOR']],
  ['POST /rx-drafts/:id/approve', RxDraftController, 'approve', ['DOCTOR']],
  ['POST /rx-drafts/:id/return', RxDraftController, 'returnDraft', ['DOCTOR']],
  ['POST /rx-drafts/:id/resubmit', RxDraftController, 'resubmit', ['ASSISTANT_DOCTOR']],
  // dispensing
  [
    'POST /direct-dispense',
    DirectDispenseController,
    'create',
    ['ASSISTANT_DOCTOR', 'DOCTOR', 'CLINIC_ADMIN', 'PHARMACIST'],
  ],
  [
    'GET /direct-dispense/stock',
    DirectDispenseController,
    'stock',
    ['ASSISTANT_DOCTOR', 'DOCTOR', 'CLINIC_ADMIN', 'PHARMACIST'],
  ],
  [
    'POST /direct-dispense/:id/reverse',
    DirectDispenseController,
    'reverse',
    ['CLINIC_ADMIN', 'PHARMACIST'],
  ],
  [
    'POST /pharmacy/prescriptions/:id/dispense',
    PharmacyController,
    'dispensePrescription',
    ['PHARMACIST'],
  ],
  [
    'POST /pharmacy-ops/prescriptions/:id/handover/code',
    PharmacyOpsController,
    'issueCode',
    ['PATIENT'],
  ],
  [
    'POST /pharmacy-ops/prescriptions/:id/handover/verify',
    PharmacyOpsController,
    'verify',
    ['CLINIC_ADMIN', 'PHARMACIST'],
  ],
  [
    'POST /pharmacy-ops/handovers/:id/confirm',
    PharmacyOpsController,
    'confirm',
    ['CLINIC_ADMIN', 'PHARMACIST'],
  ],
  // assistant read access (prices are stripped by the global interceptor)
  [
    'GET /pharmacy/inventory (medicines)',
    PharmacyController,
    'getInventory',
    ['ASSISTANT_DOCTOR', 'DOCTOR', 'CLINIC_ADMIN', 'PHARMACIST'],
  ],
  [
    'GET /pharmacy/prescriptions/:id',
    PharmacyController,
    'getPrescriptionById',
    ['PATIENT', 'RECEPTIONIST', 'ASSISTANT_DOCTOR', 'DOCTOR', 'CLINIC_ADMIN', 'PHARMACIST'],
  ],
  [
    'GET /patient-directory/:patientId',
    PatientDirectoryController,
    'findOne',
    ['RECEPTIONIST', 'ASSISTANT_DOCTOR', 'DOCTOR', 'CLINIC_ADMIN', 'PHARMACIST'],
  ],
  // billing (clinic admin owns it; reception collects; never the clinical roles)
  [
    'GET /billing/invoices/clinic',
    BillingController,
    'getClinicInvoices',
    ['RECEPTIONIST', 'CLINIC_ADMIN', 'PHARMACIST'],
  ],
  ['POST /billing/invoices', BillingController, 'createInvoice', ['RECEPTIONIST', 'CLINIC_ADMIN']],
  ['GET /billing-ops/summary', BillingOpsController, 'summary', ['CLINIC_ADMIN']],
  // staff, locations
  ['POST /staff-admin/invites', StaffAdminController, 'invite', ['CLINIC_ADMIN']],
  ['GET /staff-admin/members', StaffAdminController, 'members', ['CLINIC_ADMIN']],
  ['POST /clinics/:clinicId/locations', ClinicLocationController, 'create', ['CLINIC_ADMIN']],
  [
    'PUT /clinics/:clinicId/locations/:id/working-hours',
    ClinicLocationController,
    'updateWorkingHours',
    ['CLINIC_ADMIN'],
  ],
  [
    'POST /appointments/locations/:locationId/qr-code/regenerate',
    AppointmentsController,
    'regenerateLocationQRCode',
    ['CLINIC_ADMIN'],
  ],
  ['GET /check-in-log', CheckInLogController, 'list', ['RECEPTIONIST', 'CLINIC_ADMIN']],
];

describe('role guard matrix (key endpoints x six roles)', () => {
  it.each(MATRIX)('%s', (_label, controller, method, expected) => {
    expect(allowedRoles(controller, method)).toEqual(ROLES.filter(role => expected.includes(role)));
  });

  it('every handler of the billing controllers is closed to the doctor and the assistant', () => {
    const leaks: string[] = [];
    for (const controller of [BillingController, BillingOpsController] as AnyController[]) {
      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor' || typeof proto[name] !== 'function') continue;
        const roles = Reflect.getMetadata(ROLES_KEY, proto[name] as object) as string[] | undefined;
        if (!roles) continue;
        for (const role of ['DOCTOR', 'ASSISTANT_DOCTOR']) {
          if (roles.includes(role)) leaks.push(`${controller.name}.${name}: ${role}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it('only the doctor may call, start or complete a visit (service-level rule)', () => {
    expect(ROLES.filter(role => canControlVisit(role))).toEqual(['DOCTOR']);
  });

  it('the front desk books in-person visits only, never video', () => {
    expect(() => assertReceptionMayBook('RECEPTIONIST', 'VIDEO_CALL')).toThrow();
    expect(() => assertReceptionMayBook('RECEPTIONIST', 'IN_PERSON')).not.toThrow();
    expect(() => assertReceptionMayBook('PATIENT', 'VIDEO_CALL')).not.toThrow();
  });

  it('patient reads used by reception carry the clinical redaction', () => {
    for (const controller of [PatientsController, PatientDirectoryController]) {
      const interceptors = Reflect.getMetadata('__interceptors__', controller) as
        unknown[] | undefined;
      expect(interceptors).toContain(ReceptionClinicalRedactionInterceptor);
    }
  });
});

describe('server-side redaction by role', () => {
  const payload = {
    appointment: {
      id: 'a1',
      status: 'CONFIRMED',
      consultationFee: 500,
      payment: { amount: 500, status: 'PAID' },
    },
    invoice: { id: 'i1', totalAmount: 800, lineItems: [{ name: 'Visit', unitPrice: 800 }] },
    patient: {
      name: 'Asha',
      phone: '9999999999',
      allergies: 'penicillin',
      medicalHistory: ['asthma'],
      vitals: [{ pulse: 72 }],
      bloodGroup: 'O+',
    },
    total: 2,
  };

  async function through(
    interceptor: BillingRedactionInterceptor | ReceptionClinicalRedactionInterceptor,
    role: string
  ): Promise<typeof payload> {
    const context = contextFor(AppointmentsController, 'getAppointments', role);
    return (await lastValueFrom(
      interceptor.intercept(context, { handle: () => of(payload) })
    )) as typeof payload;
  }

  it.each(['DOCTOR', 'ASSISTANT_DOCTOR'])('strips every billing amount for %s', async role => {
    const out = await through(new BillingRedactionInterceptor(), role);
    expect(out.appointment).toEqual({ id: 'a1', status: 'CONFIRMED', payment: { status: 'PAID' } });
    expect(out.invoice).toEqual({ id: 'i1', lineItems: [{ name: 'Visit' }] });
    expect(out.total).toBe(2);
    expect(out.patient.allergies).toBe('penicillin');
  });

  it.each(['PATIENT', 'RECEPTIONIST', 'CLINIC_ADMIN', 'PHARMACIST'])(
    'keeps billing amounts for %s',
    async role => {
      const out = await through(new BillingRedactionInterceptor(), role);
      expect(out).toBe(payload);
    }
  );

  it('strips clinical fields for the receptionist only', async () => {
    const reception = await through(new ReceptionClinicalRedactionInterceptor(), 'RECEPTIONIST');
    expect(reception.patient).toEqual({ name: 'Asha', phone: '9999999999' });
    expect(reception.invoice.totalAmount).toBe(800);
    for (const role of ['DOCTOR', 'ASSISTANT_DOCTOR', 'CLINIC_ADMIN', 'PATIENT', 'PHARMACIST']) {
      expect(await through(new ReceptionClinicalRedactionInterceptor(), role)).toBe(payload);
    }
  });
});
