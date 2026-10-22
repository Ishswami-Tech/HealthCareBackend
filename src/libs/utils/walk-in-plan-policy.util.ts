/**
 * What the front desk does with an in-person visit of a patient who has no active care plan
 * (owner decision 2026-10-22: a clinic setting, not a hardcoded rule). Stored in the clinic's
 * settings JSON, edited with `PUT /clinics/:id` (no new table):
 *
 *   appointmentSettings.walkInWithoutPlan   'REQUIRE_PLAN' (default) | 'ALLOW_WITH_DESK_FEE' | 'ALLOW_FREE'
 *   appointmentSettings.walkInDeskFee       whole rupees (INR), used by ALLOW_WITH_DESK_FEE
 *
 *   REQUIRE_PLAN         the visit is refused until a plan is sold (behaviour before the setting).
 *   ALLOW_WITH_DESK_FEE  the visit goes ahead; a consultation bill is raised, payable at the desk
 *                        (PENDING, no online-checkout countdown).
 *   ALLOW_FREE           the visit goes ahead with no bill.
 *
 * Applies to staff (desk) in-person visits only. A patient booking an in-person visit in the app
 * still needs a plan, and video visits are paid per appointment as before. Pure, framework-free.
 */

export const WALK_IN_POLICY_SETTING_KEY = 'walkInWithoutPlan';
export const WALK_IN_DESK_FEE_SETTING_KEY = 'walkInDeskFee';

export const WALK_IN_PLAN_POLICIES = ['REQUIRE_PLAN', 'ALLOW_WITH_DESK_FEE', 'ALLOW_FREE'] as const;
export type WalkInPlanPolicy = (typeof WALK_IN_PLAN_POLICIES)[number];

export const DEFAULT_WALK_IN_PLAN_POLICY: WalkInPlanPolicy = 'REQUIRE_PLAN';
/** Upper bound of a desk fee (rupees): anything above is a typo, not a consultation fee. */
export const MAX_WALK_IN_DESK_FEE = 100_000;

/** Metadata key on the appointment recording that it went ahead without a plan, and how. */
export const PLAN_WAIVER_METADATA_KEY = 'planWaiver';

export const WALK_IN_PLAN_REQUIRED_MESSAGE =
  'This patient has no active care plan. Sell a plan at the desk, or change the walk-in rule in clinic settings.';

export interface WalkInPlanSettings {
  policy: WalkInPlanPolicy;
  /** Rupees; null when the clinic has not set one (the clinic consultation fee is used then). */
  deskFee: number | null;
}

/** Recorded on the appointment when it is allowed without a plan (server-written only). */
export interface PlanWaiver {
  policy: Exclude<WalkInPlanPolicy, 'REQUIRE_PLAN'>;
  deskFee: number | null;
  invoiceId: string | null;
  appliedAt: string;
  appliedBy: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function appointmentSettingsOf(settings: unknown): Record<string, unknown> {
  if (!isRecord(settings)) return {};
  return isRecord(settings['appointmentSettings']) ? settings['appointmentSettings'] : settings;
}

export function normalizeWalkInPlanPolicy(value: unknown): WalkInPlanPolicy | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return (WALK_IN_PLAN_POLICIES as readonly string[]).includes(upper)
    ? (upper as WalkInPlanPolicy)
    : null;
}

/** Whole rupees in (0, MAX_WALK_IN_DESK_FEE], or null ("12.5" rounds, "abc" / 0 / -1 do not). */
export function normalizeWalkInDeskFee(value: unknown): number | null {
  const parsed =
    typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : (value as number);
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return null;
  const rupees = Math.round(parsed);
  return rupees > 0 && rupees <= MAX_WALK_IN_DESK_FEE ? rupees : null;
}

/** The clinic's plan-less walk-in rule, defaults filled in. Accepts `Clinic.settings` as stored. */
export function resolveWalkInPlanSettings(settings: unknown): WalkInPlanSettings {
  const appointmentSettings = appointmentSettingsOf(settings);
  return {
    policy:
      normalizeWalkInPlanPolicy(appointmentSettings[WALK_IN_POLICY_SETTING_KEY]) ??
      DEFAULT_WALK_IN_PLAN_POLICY,
    deskFee: normalizeWalkInDeskFee(appointmentSettings[WALK_IN_DESK_FEE_SETTING_KEY]),
  };
}

/** The waiver recorded on an appointment, or null (absent / malformed). */
export function planWaiverOf(metadata: unknown): PlanWaiver | null {
  if (!isRecord(metadata)) return null;
  const raw = metadata[PLAN_WAIVER_METADATA_KEY];
  if (!isRecord(raw)) return null;
  const policy = normalizeWalkInPlanPolicy(raw['policy']);
  if (!policy || policy === 'REQUIRE_PLAN') return null;
  return {
    policy,
    deskFee: normalizeWalkInDeskFee(raw['deskFee']),
    invoiceId: typeof raw['invoiceId'] === 'string' ? raw['invoiceId'] : null,
    appliedAt: typeof raw['appliedAt'] === 'string' ? raw['appliedAt'] : '',
    appliedBy: typeof raw['appliedBy'] === 'string' ? raw['appliedBy'] : null,
  };
}

/** "Walk-in consultation — 22 Oct 2026" (the bill line a patient reads). */
export function walkInInvoiceDescription(dateLabel: string): string {
  return `Walk-in consultation — ${dateLabel}`;
}

/** "Desk fee ₹300 — collect at counter" / "No plan needed — free visit" for the desk screens. */
export function planWaiverOutcomeLabel(waiver: Pick<PlanWaiver, 'policy' | 'deskFee'>): string {
  if (waiver.policy === 'ALLOW_FREE') return 'No plan needed — free visit';
  return waiver.deskFee !== null
    ? `Desk fee ₹${waiver.deskFee} — collect at counter`
    : 'Desk fee — collect at counter';
}

/**
 * Cleans the two walk-in keys of an incoming `appointmentSettings` patch (PUT /clinics/:id):
 * valid values are stored normalized, invalid ones dropped (the stored value stays), `null` kept
 * so the merge deletes the key (back to the default).
 */
export function sanitizeWalkInPlanSettings(
  appointmentSettings: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...appointmentSettings };
  if (WALK_IN_POLICY_SETTING_KEY in next && next[WALK_IN_POLICY_SETTING_KEY] !== null) {
    const policy = normalizeWalkInPlanPolicy(next[WALK_IN_POLICY_SETTING_KEY]);
    if (policy) next[WALK_IN_POLICY_SETTING_KEY] = policy;
    else delete next[WALK_IN_POLICY_SETTING_KEY];
  }
  if (WALK_IN_DESK_FEE_SETTING_KEY in next && next[WALK_IN_DESK_FEE_SETTING_KEY] !== null) {
    const fee = normalizeWalkInDeskFee(next[WALK_IN_DESK_FEE_SETTING_KEY]);
    if (fee !== null) next[WALK_IN_DESK_FEE_SETTING_KEY] = fee;
    else delete next[WALK_IN_DESK_FEE_SETTING_KEY];
  }
  return next;
}
