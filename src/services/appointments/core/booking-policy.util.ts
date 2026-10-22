import { ForbiddenException } from '@nestjs/common';
import { isVideoVisit } from '@utils/in-person-flow.util';

export const RECEPTION_VIDEO_BOOKING_CODE = 'RECEPTION_CANNOT_BOOK_VIDEO';
export const RECEPTION_VIDEO_BOOKING_MESSAGE =
  'Reception cannot book video visits. Patients book video visits themselves in the app.';

/** True when `role` may create an appointment of `type` (V2: reception books in-person only). */
export function mayRoleBookType(
  role: string | null | undefined,
  type: string | null | undefined
): boolean {
  const normalized = String(role ?? '')
    .trim()
    .toUpperCase();
  return !(normalized === 'RECEPTIONIST' && isVideoVisit(type));
}

/** 403 when the front desk tries to create a video visit. */
export function assertReceptionMayBook(
  role: string | null | undefined,
  type: string | null | undefined
): void {
  if (!mayRoleBookType(role, type)) {
    throw new ForbiddenException({
      statusCode: 403,
      code: RECEPTION_VIDEO_BOOKING_CODE,
      message: RECEPTION_VIDEO_BOOKING_MESSAGE,
    });
  }
}
