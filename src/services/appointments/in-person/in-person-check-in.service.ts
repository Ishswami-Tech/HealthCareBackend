/**
 * THE in-person check-in (product rules V2). Both ways a patient arrives go through here:
 *   - the patient scans the location's QR poster in the app (method QR), and
 *   - the receptionist of that location clicks "Check in" (method MANUAL, no QR).
 * A patient who TYPES the printed desk code instead of scanning must send the device position:
 * it is verified against the location geofence (LOCATION_REQUIRED / TOO_FAR, see
 * desk-code-presence.util). Both end in the same `CheckInLocationService.processCheckIn`
 * (atomic SCHEDULED -> CONFIRMED, CheckIn row, token + entry in the location's live queue, idempotent), the same events and the
 * same check-in log row. Every refusal is logged as a failed attempt with its reason.
 */

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import type { PrismaDelegateArgs } from '@core/types/prisma.types';
import { EventService } from '@infrastructure/events/event.service';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { Role } from '@core/types/enums.types';
import { LocationQrService } from '@utils/QR';
import { formatDateKeyInIST } from '@utils/date-time.util';
import {
  IN_PERSON_TERMINAL_STAGES,
  SCAN_FAILURE_MESSAGES,
  deriveInPersonStage,
  evaluateQrScan,
  pickScanCandidate,
  type ScanFailureReason,
} from '@utils/in-person-flow.util';
import {
  CheckInLogService,
  classifyCheckInFailure,
  type CheckInFailureReason,
} from '@services/clinic-ops/services/check-in-log.service';
import { CheckInLocationService } from '../plugins/therapy/check-in-location.service';
import { CHECK_IN_EVENT_NAMES, buildCheckInEventPayload } from '../core/check-in-events.util';
import {
  DESK_CODE_LOCATION_REQUIRED_MESSAGE,
  POSTER_LOCATION_REQUIRED_MESSAGE,
  DESK_CODE_TOO_FAR_MESSAGE,
  assessDeskCodePresence,
  deskCodeTooFarMessage,
  parseDeviceFix,
  type DeviceFix,
} from '@services/appointments/core/desk-code-presence.util';
import { InPersonVisitService, type InPersonAppointmentRow } from './in-person-visit.service';
import type { InPersonActor, InPersonCheckInResult } from './in-person.types';
import type { InPersonCheckInDto } from './in-person.dto';
import type { CheckInLocation } from '@core/types/appointment.types';

/** Who may record an arrival by hand (one click, no QR). */
export const MANUAL_CHECK_IN_ROLES: ReadonlySet<string> = new Set([
  Role.RECEPTIONIST,
  Role.CLINIC_ADMIN,
  Role.CLINIC_LOCATION_HEAD,
]);

/** Every code the endpoint can answer a refused check-in with. */
export type InPersonCheckInFailureCode =
  | ScanFailureReason
  | 'INVALID_QR'
  | 'EXPIRED_QR'
  | 'LOCATION_INACTIVE'
  | 'QR_CHECK_IN_DISABLED'
  | 'QR_REQUIRED'
  | 'QR_NOT_FOR_STAFF'
  | 'APPOINTMENT_REQUIRED'
  | 'LOCATION_REQUIRED'
  | 'TOO_FAR';

const FAILURE_MESSAGES: Record<Exclude<InPersonCheckInFailureCode, ScanFailureReason>, string> = {
  INVALID_QR: 'This QR code is not a check-in code of this clinic.',
  EXPIRED_QR: 'This QR code was replaced. Please scan the new poster at the clinic.',
  LOCATION_INACTIVE: 'Check-in is switched off at this location. Please go to the reception desk.',
  // This clinic has chosen queue + reception check-in over self-service QR (smaller clinics
  // don't need it; higher-volume ones turn it on) — see appointmentSettings.opdControls.
  QR_CHECK_IN_DISABLED:
    'QR check-in is turned off at this clinic. Please wait in the queue; reception will check you in.',
  QR_REQUIRED: 'Scan the QR code at the clinic entrance to check in.',
  QR_NOT_FOR_STAFF:
    'Reception checks patients in with one click; QR scanning is only for patients.',
  APPOINTMENT_REQUIRED: 'appointmentId is required.',
  LOCATION_REQUIRED: DESK_CODE_LOCATION_REQUIRED_MESSAGE,
  TOO_FAR: DESK_CODE_TOO_FAR_MESSAGE,
};

/** The check-in log uses its own (older) vocabulary. */
const LOG_REASON: Record<InPersonCheckInFailureCode, CheckInFailureReason> = {
  WRONG_LOCATION: 'WRONG_LOCATION',
  TOO_EARLY: 'TOO_EARLY',
  EXPIRED: 'TOO_LATE',
  NOT_BOOKED: 'NOT_BOOKED',
  VIDEO_VISIT: 'OTHER',
  NOT_TODAY: 'OTHER',
  INVALID_QR: 'INVALID_QR',
  EXPIRED_QR: 'EXPIRED_QR',
  LOCATION_INACTIVE: 'LOCATION_INACTIVE',
  QR_CHECK_IN_DISABLED: 'OTHER',
  QR_REQUIRED: 'INVALID_QR',
  QR_NOT_FOR_STAFF: 'OTHER',
  APPOINTMENT_REQUIRED: 'OTHER',
  LOCATION_REQUIRED: 'LOCATION_REQUIRED',
  TOO_FAR: 'TOO_FAR',
};

/** A refused check-in: `{ statusCode, code, message }`. */
export class InPersonCheckInError extends HttpException {
  constructor(
    readonly code: InPersonCheckInFailureCode,
    message?: string
  ) {
    const status =
      code === 'NOT_BOOKED'
        ? HttpStatus.NOT_FOUND
        : code === 'TOO_FAR'
          ? HttpStatus.FORBIDDEN
          : HttpStatus.BAD_REQUEST;
    const text =
      message ??
      (code in SCAN_FAILURE_MESSAGES
        ? SCAN_FAILURE_MESSAGES[code as ScanFailureReason]
        : FAILURE_MESSAGES[code as Exclude<InPersonCheckInFailureCode, ScanFailureReason>]);
    super({ statusCode: status, code, message: text }, status);
  }
}

/** What is stored on the CheckIn row: the API shape { lat, lng } (+ accuracy when sent). */
function toStoredCoordinates(fix: DeviceFix): { lat: number; lng: number; accuracy?: number } {
  return fix.accuracy !== undefined
    ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy }
    : { lat: fix.lat, lng: fix.lng };
}

interface AttemptContext {
  clinicId: string;
  actor: InPersonActor;
  method: 'QR' | 'MANUAL' | 'WALK_IN';
  locationId: string | null;
  appointment: InPersonAppointmentRow | null;
}

@Injectable()
export class InPersonCheckInService {
  constructor(
    @Inject(forwardRef(() => CheckInLocationService))
    private readonly checkInLocations: CheckInLocationService,
    @Inject(forwardRef(() => InPersonVisitService))
    private readonly visits: InPersonVisitService,
    @Inject(forwardRef(() => LocationQrService))
    private readonly locationQr: LocationQrService,
    @Inject(forwardRef(() => EventService))
    private readonly events: EventService,
    @Inject(forwardRef(() => LoggingService))
    private readonly logging: LoggingService,
    private readonly databaseService: DatabaseService,
    @Optional() private readonly checkInLog?: CheckInLogService
  ) {}

  /** POST /in-person/check-in. */
  async checkIn(
    dto: InPersonCheckInDto,
    clinicId: string,
    actor: InPersonActor
  ): Promise<InPersonCheckInResult> {
    const role = String(actor.role ?? '').toUpperCase();
    if (role === String(Role.PATIENT)) {
      return this.checkInByQr(dto, clinicId, { ...actor, role });
    }
    if (MANUAL_CHECK_IN_ROLES.has(role)) {
      const context: AttemptContext = {
        clinicId,
        actor: { ...actor, role },
        method: 'MANUAL',
        locationId: null,
        appointment: null,
      };
      if (dto.qrCode) return this.refuse(context, 'QR_NOT_FOR_STAFF');
      if (!dto.appointmentId) return this.refuse(context, 'APPOINTMENT_REQUIRED');
      return this.checkInManually(dto.appointmentId, clinicId, { ...actor, role });
    }
    throw new ForbiddenException(
      'Only patients (QR) and the reception desk can check a patient in.'
    );
  }

  /**
   * Reception one-click check-in. Restricted to the receptionist's allotted location (403
   * RECEPTION_WRONG_LOCATION); allowed any time on the visit day. `method: 'WALK_IN'` only tags
   * the check-in log row of a walk-in registered at the desk (same check-in otherwise).
   */
  async checkInManually(
    appointmentId: string,
    clinicId: string,
    actor: InPersonActor,
    options: { method?: 'MANUAL' | 'WALK_IN' } = {}
  ): Promise<InPersonCheckInResult> {
    const context: AttemptContext = {
      clinicId,
      actor,
      method: options.method ?? 'MANUAL',
      locationId: null,
      appointment: null,
    };
    let row: InPersonAppointmentRow;
    try {
      row = await this.visits.loadForActor(appointmentId, clinicId, actor);
    } catch (error) {
      await this.logFailure(context, error);
      throw error;
    }
    context.appointment = row;
    context.locationId = row.locationId;

    const stage = deriveInPersonStage(row);
    if (IN_PERSON_TERMINAL_STAGES.has(stage)) {
      return this.refuse(
        context,
        stage === 'CANCELLED' || stage === 'COMPLETED' ? 'NOT_BOOKED' : 'EXPIRED'
      );
    }
    if (formatDateKeyInIST(row.date) !== formatDateKeyInIST(new Date())) {
      return this.refuse(context, 'NOT_TODAY');
    }
    if (!row.locationId) return this.refuse(context, 'WRONG_LOCATION');

    return this.confirmArrival(context, row, {
      locationId: row.locationId,
      presence: 'skip',
    });
  }

  /**
   * Clinic-wide "QR Check-in Enabled" toggle (appointmentSettings.opdControls.qrCheckInEnabled,
   * set from the clinic-admin settings page): a small/low-volume clinic can turn self-service
   * QR scanning off and rely on the queue + reception's one-click check-in instead, while a
   * high-volume clinic turns it on. Defaults to enabled when unset.
   */
  private async isQrCheckInEnabled(clinicId: string): Promise<boolean> {
    const opdControls = await this.readOpdControls(clinicId);
    return Boolean(opdControls['qrCheckInEnabled'] ?? true);
  }

  /**
   * Clinic-wide "Require location for QR check-in" toggle
   * (appointmentSettings.opdControls.requireLocationForQrCheckIn). When on (the default) a
   * patient's poster scan must carry a device position inside the location geofence; without it
   * the scan is refused (LOCATION_REQUIRED) and the patient is pointed to the reception desk,
   * so a photographed poster cannot check anyone in from elsewhere.
   */
  private async isLocationRequiredForQrCheckIn(clinicId: string): Promise<boolean> {
    const opdControls = await this.readOpdControls(clinicId);
    return Boolean(opdControls['requireLocationForQrCheckIn'] ?? true);
  }

  private async readOpdControls(clinicId: string): Promise<Record<string, unknown>> {
    const clinic = await this.databaseService.executeHealthcareRead<{
      settings: unknown;
    } | null>(async client => {
      const typedClient = client as unknown as {
        clinic: {
          findUnique: (args: PrismaDelegateArgs) => Promise<{ settings: unknown } | null>;
        };
      };
      return await typedClient.clinic.findUnique({
        where: { id: clinicId } as PrismaDelegateArgs,
        select: { settings: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
    const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value);
    const settings = isPlainRecord(clinic?.settings) ? clinic.settings : {};
    const appointmentSettings = isPlainRecord(settings['appointmentSettings'])
      ? settings['appointmentSettings']
      : {};
    return isPlainRecord(appointmentSettings['opdControls'])
      ? appointmentSettings['opdControls']
      : {};
  }

  /** Patient scans the poster of the location they booked. */
  async checkInByQr(
    dto: InPersonCheckInDto,
    clinicId: string,
    actor: InPersonActor
  ): Promise<InPersonCheckInResult> {
    const context: AttemptContext = {
      clinicId,
      actor,
      method: 'QR',
      locationId: null,
      appointment: null,
    };
    if (!(await this.isQrCheckInEnabled(clinicId))) {
      return this.refuse(context, 'QR_CHECK_IN_DISABLED');
    }
    if (!dto.qrCode || !dto.qrCode.trim()) return this.refuse(context, 'QR_REQUIRED');

    const { location, isTypedDeskCode } = await this.resolveScannedLocation(
      dto.qrCode.trim(),
      context
    );
    const scannedIds = [location.locationId, location.id];
    context.locationId = location.locationId || location.id;

    const bookings = await this.visits.findPatientBookingsToday(clinicId, actor.userId);
    const { match, ambiguous } = pickScanCandidate(bookings, scannedIds, dto.appointmentId);
    if (ambiguous.length > 0) {
      return { result: 'SELECT_APPOINTMENT', candidates: await this.visits.toVisits(ambiguous) };
    }
    context.appointment = match;

    const decision = evaluateQrScan(match, scannedIds);
    if (!decision.ok) return this.refuse(context, decision.reason, decision.message);
    const booking = match as InPersonAppointmentRow;

    // Typed desk code: the device position is the presence proof (verified here, with the GPS
    // accuracy allowance). Scanned signed poster: the position is required too unless the clinic
    // turned that off, because the poster itself is static and can be photographed.
    const fix = parseDeviceFix(dto.coordinates);
    const verifyPositionHere =
      isTypedDeskCode || (await this.isLocationRequiredForQrCheckIn(clinicId));
    if (verifyPositionHere) {
      await this.assertDeskCodePresence(context, location, dto.coordinates, !isTypedDeskCode);
    }
    // An unparseable position on the poster path goes through as sent, so processCheckIn still
    // answers 400 "Invalid check-in coordinates" (unchanged 'if-supplied' behaviour).
    const storedCoordinates = fix
      ? toStoredCoordinates(fix)
      : (dto.coordinates as { lat: number; lng: number } | undefined);
    const confirm = (): Promise<InPersonCheckInResult> =>
      this.confirmArrival(context, booking, {
        locationId: location.id,
        presence: verifyPositionHere ? 'skip' : 'if-supplied',
        ...(storedCoordinates !== undefined ? { coordinates: storedCoordinates } : {}),
        ...(dto.deviceInfo !== undefined ? { deviceInfo: dto.deviceInfo } : {}),
      });
    if (!decision.alreadyCheckedIn) return confirm();

    // Idempotent re-scan: inside the window it also repairs a missing queue entry; after the
    // slot has ended the arrival simply stands (no error for a patient already in the queue).
    try {
      return await confirm();
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      const [visit] = await this.visits.toVisits([booking]);
      if (!visit) throw error;
      return { result: 'CHECKED_IN', alreadyCheckedIn: true, visit };
    }
  }

  /**
   * PATIENT typed the printed desk code: coordinates are mandatory and must be inside the
   * location radius (+ capped GPS accuracy allowance). Refusals are logged with their reason.
   */
  private async assertDeskCodePresence(
    context: AttemptContext,
    location: CheckInLocation,
    coordinates: unknown,
    isPosterScan = false
  ): Promise<void> {
    const presence = assessDeskCodePresence(coordinates, location);
    if (!presence.ok) {
      if (presence.code === 'LOCATION_REQUIRED') {
        return isPosterScan
          ? this.refuse(context, 'LOCATION_REQUIRED', POSTER_LOCATION_REQUIRED_MESSAGE)
          : this.refuse(context, 'LOCATION_REQUIRED');
      }
      return this.refuse(context, 'TOO_FAR', deskCodeTooFarMessage(presence.distanceMeters));
    }
    if (presence.unverifiable) {
      void this.logging.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Desk-code check-in at a location without a usable geofence; position not verified',
        'InPersonCheckInService',
        { locationId: location.id, clinicId: context.clinicId }
      );
    }
  }

  /** Signed poster JSON (with version) or the printed manual code; refusals are logged. */
  private async resolveScannedLocation(
    qrCode: string,
    context: AttemptContext
  ): Promise<{ location: CheckInLocation; isTypedDeskCode: boolean }> {
    let posterLocationId: string | null = null;
    try {
      const parsed = JSON.parse(qrCode) as { locationId?: unknown; type?: unknown };
      if (typeof parsed.locationId === 'string' && parsed.type === 'LOCATION_CHECK_IN') {
        posterLocationId = parsed.locationId;
      }
    } catch {
      // not JSON: the printed manual code (CheckInLocation.qrCode)
    }

    let location: CheckInLocation;
    try {
      location = posterLocationId
        ? await this.checkInLocations.getLocationById(posterLocationId, context.clinicId)
        : await this.checkInLocations.getLocationByQRCode(qrCode, context.clinicId);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        return this.refuse(context, 'INVALID_QR');
      }
      throw error;
    }
    context.locationId = location.locationId || location.id;

    if (posterLocationId) {
      const inspection = this.locationQr.inspectLocationQR(
        qrCode,
        posterLocationId,
        context.clinicId,
        location.qrVersion ?? 1
      );
      if (inspection === 'INVALID') return this.refuse(context, 'INVALID_QR');
      if (inspection === 'REPLACED') return this.refuse(context, 'EXPIRED_QR');
    }
    if (!location.isActive) return this.refuse(context, 'LOCATION_INACTIVE');
    return { location, isTypedDeskCode: posterLocationId === null };
  }

  /** The shared write: processCheckIn, events, log, fresh read model. */
  private async confirmArrival(
    context: AttemptContext,
    row: InPersonAppointmentRow,
    options: {
      locationId: string;
      presence: 'skip' | 'if-supplied';
      coordinates?: { lat: number; lng: number; accuracy?: number };
      deviceInfo?: Record<string, unknown>;
    }
  ): Promise<InPersonCheckInResult> {
    let processed;
    try {
      processed = await this.checkInLocations.processCheckIn(
        {
          appointmentId: row.id,
          locationId: options.locationId,
          patientId: row.patientId,
          ...(options.coordinates ? { coordinates: options.coordinates } : {}),
          ...(options.deviceInfo ? { deviceInfo: options.deviceInfo } : {}),
        },
        context.clinicId,
        { actor: context.actor, presence: options.presence }
      );
    } catch (error) {
      await this.logFailure(context, error);
      throw error;
    }

    const alreadyCheckedIn = processed.alreadyCheckedIn === true;
    if (!alreadyCheckedIn || processed.queueRepaired) {
      const payload = buildCheckInEventPayload({
        appointmentId: row.id,
        clinicId: context.clinicId,
        patientId: row.patientId,
        doctorId: row.doctorId,
        ...(row.locationId ? { locationId: row.locationId } : {}),
        checkedInBy: context.actor.userId,
        checkInMethod: context.method === 'QR' ? 'qr' : 'manual',
        source: 'InPersonCheckInService',
      });
      for (const name of CHECK_IN_EVENT_NAMES) {
        try {
          await this.events.emit(name, payload);
        } catch (error) {
          void this.logging.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Check-in event ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
            'InPersonCheckInService',
            { appointmentId: row.id }
          );
        }
      }
    }

    const fresh = await this.visits.loadForActor(row.id, context.clinicId, {
      userId: context.actor.userId,
      role: context.actor.role,
    });
    const [visit] = await this.visits.toVisits([fresh]);
    if (!visit) throw new NotFoundException('Appointment not found');

    if (!alreadyCheckedIn) {
      await this.checkInLog?.recordAttempt({
        clinicId: context.clinicId,
        locationId: row.locationId,
        appointmentId: row.id,
        patientId: row.patientId,
        patientName: visit.patientName,
        actorUserId: context.actor.userId,
        actorRole: context.actor.role,
        method: context.method,
        outcome: 'SUCCESS',
        tokenLabel: visit.token,
      });
    }
    return { result: 'CHECKED_IN', alreadyCheckedIn, visit };
  }

  private async refuse(
    context: AttemptContext,
    code: InPersonCheckInFailureCode,
    message?: string
  ): Promise<never> {
    const error = new InPersonCheckInError(code, message);
    await this.logFailure(context, error);
    throw error;
  }

  /** Never throws: the log must not change the answer. */
  private async logFailure(context: AttemptContext, error: unknown): Promise<void> {
    const reason =
      error instanceof InPersonCheckInError
        ? { reason: LOG_REASON[error.code], detail: `${error.code}: ${error.message}` }
        : classifyCheckInFailure(error);
    try {
      await this.checkInLog?.recordAttempt({
        clinicId: context.clinicId,
        locationId: context.locationId,
        appointmentId: context.appointment?.id ?? null,
        patientId: context.appointment?.patientId ?? null,
        actorUserId: context.actor.userId,
        actorRole: context.actor.role,
        method: context.method,
        outcome: 'FAILED',
        failureReason: reason.reason,
        failureDetail: reason.detail,
      });
    } catch {
      // recordAttempt never throws; belt and braces
    }
  }
}
