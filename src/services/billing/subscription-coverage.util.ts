/**
 * Which appointment types a subscription plan may cover.
 *
 * Product rule (owner-confirmed): a plan such as the "Ayurveda Care Plan" covers ONLY in-person
 * (IN_PERSON) visits. A video consultation (VIDEO_CALL) is never covered by any plan: it is always
 * paid per appointment, whatever the plan row's `appointmentTypes` says.
 */

/** The only appointment type a plan can ever cover. */
export const PLAN_COVERABLE_APPOINTMENT_TYPE = 'IN_PERSON';

/** 402-style refusal text for a type no plan covers. */
export const VIDEO_NOT_COVERED_REASON =
  'Video consultations are paid per visit; they are not covered by a plan.';

/** True when a plan may cover this appointment type (IN_PERSON only). */
export function isPlanCoverableAppointmentType(appointmentType: unknown): boolean {
  return (
    typeof appointmentType === 'string' &&
    appointmentType.trim().toUpperCase() === PLAN_COVERABLE_APPOINTMENT_TYPE
  );
}

/**
 * The plan's covered appointment types after the product rule: every non-in-person type is
 * forced to false, so a stale `{ VIDEO_CALL: true }` on a plan row can never zero-price a video.
 */
export function effectivePlanAppointmentTypes(appointmentTypes: unknown): Record<string, boolean> {
  const source =
    appointmentTypes && typeof appointmentTypes === 'object' && !Array.isArray(appointmentTypes)
      ? (appointmentTypes as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    Object.entries(source).map(([type, covered]) => [
      type,
      covered === true && isPlanCoverableAppointmentType(type),
    ])
  );
}
