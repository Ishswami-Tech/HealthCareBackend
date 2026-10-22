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
  planWaiverOf,
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
});
