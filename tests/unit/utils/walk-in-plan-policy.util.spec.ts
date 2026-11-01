/**
 * Plan-less walk-in rule (clinic settings JSON): REQUIRE_PLAN (default) | ALLOW_WITH_DESK_FEE |
 * ALLOW_FREE, with walkInDeskFee in rupees. src/libs/utils/walk-in-plan-policy.util.ts
 */
import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_WALK_IN_PLAN_POLICY,
  WALK_IN_PLAN_REQUIRED_MESSAGE,
  normalizeWalkInDeskFee,
  normalizeWalkInPlanPolicy,
  pickConsultationFee,
  planWaiverOf,
  resolveExpectedWalkInFee,
  planWaiverOutcomeLabel,
  resolveWalkInPlanSettings,
  sanitizeWalkInPlanSettings,
  walkInInvoiceDescription,
} from '@utils/walk-in-plan-policy.util';

describe('walk-in without plan policy resolver', () => {
  it('defaults to REQUIRE_PLAN with no fee (behaviour before the setting)', () => {
    expect(DEFAULT_WALK_IN_PLAN_POLICY).toBe('REQUIRE_PLAN');
    expect(resolveWalkInPlanSettings(undefined)).toEqual({ policy: 'REQUIRE_PLAN', deskFee: null });
    expect(resolveWalkInPlanSettings({ appointmentSettings: {} })).toEqual({
      policy: 'REQUIRE_PLAN',
      deskFee: null,
    });
    expect(WALK_IN_PLAN_REQUIRED_MESSAGE).toBe(
      'This patient has no active care plan. Sell a plan at the desk, or change the walk-in rule in clinic settings.'
    );
  });

  it('reads the clinic settings (whole JSON or appointmentSettings)', () => {
    expect(
      resolveWalkInPlanSettings({
        appointmentSettings: { walkInWithoutPlan: 'ALLOW_WITH_DESK_FEE', walkInDeskFee: 300 },
      })
    ).toEqual({ policy: 'ALLOW_WITH_DESK_FEE', deskFee: 300 });
    expect(resolveWalkInPlanSettings({ walkInWithoutPlan: 'allow_free' })).toEqual({
      policy: 'ALLOW_FREE',
      deskFee: null,
    });
  });

  it('an unknown policy falls back to REQUIRE_PLAN; a bad fee is no fee', () => {
    expect(normalizeWalkInPlanPolicy('ALLOW_ALL')).toBeNull();
    expect(resolveWalkInPlanSettings({ walkInWithoutPlan: 'ALLOW_ALL' }).policy).toBe(
      'REQUIRE_PLAN'
    );
    expect(normalizeWalkInDeskFee('250.4')).toBe(250);
    expect(normalizeWalkInDeskFee(0)).toBeNull();
    expect(normalizeWalkInDeskFee(-5)).toBeNull();
    expect(normalizeWalkInDeskFee('abc')).toBeNull();
    expect(normalizeWalkInDeskFee(1_000_000)).toBeNull();
  });

  it('PUT sanitizer normalizes valid values, drops invalid ones, keeps null (reset)', () => {
    expect(
      sanitizeWalkInPlanSettings({ walkInWithoutPlan: 'allow_with_desk_fee', walkInDeskFee: '300' })
    ).toEqual({ walkInWithoutPlan: 'ALLOW_WITH_DESK_FEE', walkInDeskFee: 300 });
    expect(sanitizeWalkInPlanSettings({ walkInWithoutPlan: 'nope', walkInDeskFee: -1 })).toEqual(
      {}
    );
    expect(sanitizeWalkInPlanSettings({ walkInWithoutPlan: null, walkInDeskFee: null })).toEqual({
      walkInWithoutPlan: null,
      walkInDeskFee: null,
    });
  });

  it('reads a recorded waiver from appointment metadata, ignores malformed ones', () => {
    expect(
      planWaiverOf({
        isWalkIn: true,
        planWaiver: {
          policy: 'ALLOW_WITH_DESK_FEE',
          deskFee: 300,
          invoiceId: 'inv-1',
          appliedAt: '2026-10-22T05:00:00.000Z',
          appliedBy: 'u-1',
        },
      })
    ).toEqual({
      policy: 'ALLOW_WITH_DESK_FEE',
      deskFee: 300,
      invoiceId: 'inv-1',
      appliedAt: '2026-10-22T05:00:00.000Z',
      appliedBy: 'u-1',
    });
    expect(planWaiverOf({ planWaiver: { policy: 'REQUIRE_PLAN' } })).toBeNull();
    expect(planWaiverOf({ planWaiver: 'yes' })).toBeNull();
    expect(planWaiverOf(null)).toBeNull();
  });

  it('desk copy and bill description', () => {
    expect(planWaiverOutcomeLabel({ policy: 'ALLOW_WITH_DESK_FEE', deskFee: 300 })).toBe(
      'Desk fee ₹300 — collect at counter'
    );
    expect(planWaiverOutcomeLabel({ policy: 'ALLOW_FREE', deskFee: null })).toBe(
      'No plan needed — free visit'
    );
    expect(walkInInvoiceDescription('22 Oct 2026')).toBe('Walk-in consultation — 22 Oct 2026');
  });

  it('consultation fee: the doctor fee first, else the clinic default', () => {
    expect(pickConsultationFee(500, 300)).toEqual({ amount: 500, source: 'doctor' });
    expect(pickConsultationFee(null, 300)).toEqual({ amount: 300, source: 'clinic' });
    expect(pickConsultationFee(0, undefined)).toBeNull();
  });
});

describe('expected walk-in fee (patient clinic payload)', () => {
  const deskFeeRule = { policy: 'ALLOW_WITH_DESK_FEE' as const, deskFee: null };

  it('no fee when the clinic does not bill plan-less walk-ins', () => {
    for (const policy of ['REQUIRE_PLAN', 'ALLOW_FREE'] as const) {
      expect(
        resolveExpectedWalkInFee({
          rule: { policy, deskFee: 300 },
          clinicConsultationFee: 400,
          doctorFees: [500],
        })
      ).toEqual({ basis: null, amount: null, minAmount: null, maxAmount: null });
    }
  });

  it('the desk fee wins when set', () => {
    expect(
      resolveExpectedWalkInFee({
        rule: { policy: 'ALLOW_WITH_DESK_FEE', deskFee: 300 },
        clinicConsultationFee: 400,
        doctorFees: [500, 600],
      })
    ).toEqual({ basis: 'desk_fee', amount: 300, minAmount: 300, maxAmount: 300 });
  });

  it('desk fee blank, clinic fee blank: the doctor fee (re-test D9b: ₹500)', () => {
    expect(
      resolveExpectedWalkInFee({
        rule: deskFeeRule,
        clinicConsultationFee: undefined,
        doctorFees: [500],
      })
    ).toEqual({ basis: 'doctor_fee', amount: 500, minAmount: 500, maxAmount: 500 });
  });

  it('doctors without a fee bill the clinic fee, like the desk invoice', () => {
    expect(
      resolveExpectedWalkInFee({
        rule: deskFeeRule,
        clinicConsultationFee: 400,
        doctorFees: [null, 0],
      })
    ).toEqual({ basis: 'clinic_consultation_fee', amount: 400, minAmount: 400, maxAmount: 400 });
    expect(
      resolveExpectedWalkInFee({ rule: deskFeeRule, clinicConsultationFee: 400, doctorFees: [] })
    ).toEqual({ basis: 'clinic_consultation_fee', amount: 400, minAmount: 400, maxAmount: 400 });
  });

  it('a range when the doctors differ (a doctor with no fee counts at the clinic fee)', () => {
    expect(
      resolveExpectedWalkInFee({
        rule: deskFeeRule,
        clinicConsultationFee: 400,
        doctorFees: [600, null, 500],
      })
    ).toEqual({ basis: 'doctor_fee_range', amount: null, minAmount: 400, maxAmount: 600 });
  });

  it('nothing configured anywhere: unknown', () => {
    expect(
      resolveExpectedWalkInFee({
        rule: deskFeeRule,
        clinicConsultationFee: null,
        doctorFees: [null],
      })
    ).toEqual({ basis: null, amount: null, minAmount: null, maxAmount: null });
  });
});
