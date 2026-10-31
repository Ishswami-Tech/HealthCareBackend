import { describe, expect, it } from '@jest/globals';
import {
  CLINIC_DAY_AUDIT_EVENT_NAMES,
  clinicDayAuditKey,
  createRecentKeyGuard,
  resolveClinicDayAudit,
} from '@services/clinic-ops/services/clinic-day-audit.util';
import { buildCheckInEventPayload } from '@services/appointments/core/check-in-events.util';

const CLINIC = 'clinic-1';

/** What EventService.emit() hands listeners: the simple payload wrapped in an envelope. */
function simpleEnvelope(eventType: string, payload: Record<string, unknown>): unknown {
  return {
    eventId: 'evt-1',
    eventType,
    source: 'EventService',
    ...(typeof payload['clinicId'] === 'string' ? { clinicId: payload['clinicId'] } : {}),
    ...(typeof payload['userId'] === 'string' ? { userId: payload['userId'] } : {}),
    payload,
  };
}

describe('resolveClinicDayAudit', () => {
  it('listens to check-in, consultation start/complete, payment and EHR prescription', () => {
    expect([...CLINIC_DAY_AUDIT_EVENT_NAMES].sort()).toEqual(
      [
        'appointment.checked_in',
        'appointment.completed',
        'appointment.consultation_started',
        'ehr.prescription.created',
        'payment.completed',
      ].sort()
    );
  });

  it('maps every check-in path (shared payload builder) to CHECK_IN by the receptionist', () => {
    const payload = buildCheckInEventPayload({
      appointmentId: 'appt-1',
      clinicId: CLINIC,
      patientId: 'patient-1',
      doctorId: 'doc-1',
      locationId: 'loc-1',
      checkedInBy: 'reception-1',
      checkInMethod: 'MANUAL',
      source: 'AppointmentsController.checkIn',
      notes: 'patient arrived with a fever of 102',
    });

    const intent = resolveClinicDayAudit(
      'appointment.checked_in',
      simpleEnvelope('appointment.checked_in', payload)
    );

    expect(intent).toMatchObject({
      clinicId: CLINIC,
      entityType: 'APPOINTMENT',
      entityId: 'appt-1',
      action: 'CHECK_IN',
      actorUserId: 'reception-1',
      actorRole: null, // resolved from the user row by the listener
    });
    expect(intent?.detail).toMatchObject({ checkInMethod: 'MANUAL', locationId: 'loc-1' });
    // The free-text notes are never copied into the audit row.
    expect(JSON.stringify(intent)).not.toContain('fever');
  });

  it('takes the consultation starter from the envelope (AppointmentsService)', () => {
    const intent = resolveClinicDayAudit('appointment.consultation_started', {
      eventId: 'e',
      clinicId: CLINIC,
      userId: 'doctor-user-1',
      payload: { id: 'appt-2', status: 'IN_PROGRESS', userId: 'patient-user-9' },
      metadata: { appointmentId: 'appt-2', doctorId: 'doc-1' },
    });

    expect(intent).toMatchObject({
      entityId: 'appt-2',
      action: 'CONSULTATION_STARTED',
      actorUserId: 'doctor-user-1',
    });
    expect(intent?.detail).toMatchObject({ doctorId: 'doc-1', status: 'IN_PROGRESS' });
  });

  it('takes the consultation starter from payload.userId on the queue (call-next) path', () => {
    const intent = resolveClinicDayAudit('appointment.consultation_started', {
      eventId: 'e',
      source: 'AppointmentQueueService',
      payload: { appointmentId: 'appt-3', clinicId: CLINIC, userId: 'doctor-user-2' },
    });

    expect(intent).toMatchObject({
      clinicId: CLINIC,
      entityId: 'appt-3',
      actorUserId: 'doctor-user-2',
    });
  });

  it('never attributes a completion to the patient on the envelope', () => {
    const byDoctor = resolveClinicDayAudit('appointment.completed', {
      clinicId: CLINIC,
      userId: 'patient-user-1',
      payload: { appointmentId: 'appt-4', completedBy: 'doctor-user-1', status: 'COMPLETED' },
    });
    const byCron = resolveClinicDayAudit('appointment.completed', {
      clinicId: CLINIC,
      userId: 'patient-user-1',
      payload: { appointmentId: 'appt-5', reason: 'Auto-closed after the video window' },
    });

    expect(byDoctor).toMatchObject({
      action: 'CONSULTATION_COMPLETED',
      actorUserId: 'doctor-user-1',
    });
    expect(byCron).toMatchObject({ actorUserId: null, actorRole: 'SYSTEM' });
    expect(JSON.stringify(byCron)).not.toContain('Auto-closed');
  });

  it('treats "system" placeholders as the system acting', () => {
    const intent = resolveClinicDayAudit('appointment.completed', {
      clinicId: CLINIC,
      payload: { appointmentId: 'appt-6', completedBy: 'system' },
    });
    expect(intent).toMatchObject({ actorUserId: null, actorRole: 'SYSTEM' });
  });

  it('records a completed payment by its payment id, never the payer as actor', () => {
    const intent = resolveClinicDayAudit('payment.completed', {
      eventId: 'payment-completed-pay-1',
      clinicId: CLINIC,
      userId: 'patient-user-1',
      metadata: { paymentId: 'pay-1', amount: 50000, appointmentId: 'appt-7' },
      payload: { appointment: { id: 'appt-7' } },
    });

    expect(intent).toMatchObject({
      entityType: 'PAYMENT',
      entityId: 'pay-1',
      action: 'PAYMENT_COLLECTED',
      actorUserId: null,
    });
    expect(intent?.detail).toMatchObject({ amount: 50000, appointmentId: 'appt-7' });
  });

  it('records the prescriber of an EHR prescription and drops diagnosis / notes', () => {
    const intent = resolveClinicDayAudit(
      'ehr.prescription.created',
      simpleEnvelope('ehr.prescription.created', {
        userId: 'patient-user-1',
        clinicId: CLINIC,
        prescriptionId: 'rx-1',
        prescribedByUserId: 'doctor-user-1',
        actorRole: 'doctor',
        medicationsCount: 2,
        diagnosis: 'Type 2 diabetes',
        notes: 'Take after meals',
      })
    );

    expect(intent).toMatchObject({
      entityType: 'PRESCRIPTION',
      entityId: 'rx-1',
      actorUserId: 'doctor-user-1',
      actorRole: 'DOCTOR',
    });
    expect(JSON.stringify(intent)).not.toMatch(/diabetes|meals|patient-user-1/);
  });

  it('returns null for unknown events and events without clinic or entity id', () => {
    expect(resolveClinicDayAudit('appointment.queue.updated', { clinicId: CLINIC })).toBeNull();
    expect(
      resolveClinicDayAudit('appointment.completed', { payload: { appointmentId: 'a' } })
    ).toBeNull();
    expect(
      resolveClinicDayAudit('appointment.completed', { clinicId: CLINIC, payload: {} })
    ).toBeNull();
    expect(resolveClinicDayAudit('appointment.completed', null)).toBeNull();
  });

  it('rejects ids that are not id-like (no free text smuggled through id fields)', () => {
    const intent = resolveClinicDayAudit('appointment.checked_in', {
      clinicId: CLINIC,
      payload: { appointmentId: 'appt 1; DROP TABLE', id: 'appt-ok', checkedInBy: 'u-1' },
    });
    expect(intent?.entityId).toBe('appt-ok');
  });
});

describe('createRecentKeyGuard', () => {
  it('admits a key once inside the window and again after it', () => {
    const guard = createRecentKeyGuard(1000, 100);
    expect(guard.firstSeen('k', 0)).toBe(true);
    expect(guard.firstSeen('k', 500)).toBe(false);
    expect(guard.firstSeen('k', 1500)).toBe(true);
  });

  it('dedupes the enterprise + simple double emission of one completion', () => {
    const guard = createRecentKeyGuard(120_000, 100);
    const first = resolveClinicDayAudit('appointment.completed', {
      clinicId: CLINIC,
      payload: { appointmentId: 'appt-9', completedBy: 'doctor-user-1' },
    });
    const second = resolveClinicDayAudit(
      'appointment.completed',
      simpleEnvelope('appointment.completed', { appointmentId: 'appt-9', clinicId: CLINIC })
    );
    expect(first && guard.firstSeen(clinicDayAuditKey(first), 10)).toBe(true);
    expect(second && guard.firstSeen(clinicDayAuditKey(second), 20)).toBe(false);
  });

  it('stays bounded', () => {
    const guard = createRecentKeyGuard(60_000, 3);
    for (let i = 0; i < 10; i++) guard.firstSeen(`k${i}`, i);
    expect(guard.size).toBeLessThanOrEqual(4);
  });
});
