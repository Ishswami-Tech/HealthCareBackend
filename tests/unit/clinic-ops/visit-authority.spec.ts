import { describe, it, expect } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { assertDoctorControlsVisit, canControlVisit } from '@core/rbac/visit-authority.util';

describe('visit authority', () => {
  it('lets only the doctor (and the system worker) call, start or complete a visit', () => {
    expect(canControlVisit('DOCTOR')).toBe(true);
    expect(canControlVisit('doctor')).toBe(true);
    expect(canControlVisit('SYSTEM')).toBe(true);
    for (const role of [
      'ASSISTANT_DOCTOR',
      'RECEPTIONIST',
      'CLINIC_ADMIN',
      'NURSE',
      'PATIENT',
      undefined,
    ]) {
      expect(canControlVisit(role)).toBe(false);
      expect(() => assertDoctorControlsVisit(role)).toThrow(ForbiddenException);
    }
  });
});
