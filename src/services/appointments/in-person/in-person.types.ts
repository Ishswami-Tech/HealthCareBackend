/**
 * In-person flow V2 - response shapes (see API_CONTRACT "In-person flow V2").
 */

import type { CheckInWindowState, InPersonStage } from '@utils/in-person-flow.util';

export interface InPersonVisit {
  appointmentId: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  locationId: string | null;
  locationName: string | null;
  /** IST calendar day, YYYY-MM-DD. */
  date: string;
  /** IST wall-clock slot start, HH:mm. */
  time: string;
  durationMinutes: number;
  stage: InPersonStage;
  appointmentStatus: string;
  checkedInAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  tokenNumber: number | null;
  /** "K-014" once checked in. */
  token: string | null;
  /** Same as `token` (the name GET /queue and GET /appointments rows use). */
  tokenLabel: string | null;
  /** Booked as a walk-in at the reception desk (booking metadata). */
  isWalkIn: boolean;
  /** 1-based place among the waiting patients (0 while with the doctor), null when not queued. */
  position: number | null;
  peopleAhead: number | null;
  etaMinutes: number | null;
  /** Checked in and nobody waiting ahead: the "You're next" state. */
  isNext: boolean;
  nowServingToken: string | null;
  checkInWindow: { opensAt: string; closesAt: string; state: CheckInWindowState } | null;
  priority: string | null;
}

export type InPersonCheckInResult =
  | { result: 'CHECKED_IN'; alreadyCheckedIn: boolean; visit: InPersonVisit }
  | { result: 'SELECT_APPOINTMENT'; candidates: InPersonVisit[] };

export interface InPersonDeskBoard {
  locationId: string;
  locationName: string | null;
  date: string;
  counts: Record<
    'booked' | 'checkedIn' | 'withDoctor' | 'completed' | 'noShow' | 'expired' | 'cancelled',
    number
  >;
  visits: InPersonVisit[];
  /** Appointments of the location/day (equals visits.length unless `truncated`). */
  total: number;
  /** true when the day has more than DESK_BOARD_MAX_ROWS (3000) visits: counts cover `visits`. */
  truncated: boolean;
  /** Present when the board was asked for one page (`?page=&limit=`): counts still cover the day. */
  page?: number;
  limit?: number;
  totalPages?: number;
}

export interface BookingLocation {
  locationId: string;
  name: string;
  address: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceMeters: number | null;
  isNearest: boolean;
  checkInEnabled: boolean;
}

/** Who is asking (from the JWT). */
export interface InPersonActor {
  userId: string;
  role: string;
}

/** POST /in-person/walk-in: the check-in result, plus whether a new appointment was created. */
export type InPersonWalkInResult = Extract<InPersonCheckInResult, { result: 'CHECKED_IN' }> & {
  created: boolean;
  /**
   * Set when the patient had no active plan and the clinic's walk-in rule let the visit go ahead:
   * ALLOW_FREE (no bill) or ALLOW_WITH_DESK_FEE (a PENDING bill of `deskFee` rupees, collected at
   * the counter). `label` is the desk copy, e.g. "Desk fee ₹300 — collect at counter".
   */
  planWaiver?: InPersonPlanWaiverOutcome | null;
};

export interface InPersonPlanWaiverOutcome {
  policy: 'ALLOW_WITH_DESK_FEE' | 'ALLOW_FREE';
  deskFee: number | null;
  invoiceId: string | null;
  label: string;
}

/** POST /in-person/appointments/:id/undo-no-show. */
export interface InPersonUndoNoShowResult {
  result: 'RESTORED';
  /** The visit was not a no-show any more (a repeat click): nothing changed. */
  alreadyRestored: boolean;
  /** CONFIRMED (back in the queue) when the patient had checked in, else SCHEDULED. */
  restoredStatus: 'CONFIRMED' | 'SCHEDULED';
  visit: InPersonVisit;
}
