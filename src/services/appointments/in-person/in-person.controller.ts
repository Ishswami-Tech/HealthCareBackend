/**
 * In-person flow V2 endpoints (see API_CONTRACT "In-person flow V2").
 *   GET  /in-person/locations?lat&lng        booking: clinic locations, nearest first
 *   GET  /in-person/me/today                 patient: today's in-person bookings with stage / token
 *   GET  /in-person/appointments/:id         one visit: stage, token, people ahead, ETA, window
 *   POST /in-person/check-in                 patient QR scan OR reception one-click (same service)
 *   GET  /in-person/desk?date&locationId     reception: every appointment of its location today
 *   GET  /in-person/desk/fees-due?date       reception: unpaid desk fees of today's visits there
 *   POST /in-person/walk-in                  reception: book "now" + check in (idempotent)
 *   POST /in-person/appointments/:id/undo-no-show   put a mistaken no-show back (queue restored)
 * Calling / starting / completing stays doctor-only in /queue and /appointments.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { InvalidateAppointmentCacheByTags } from '@core/decorators';
import { Role } from '@core/types/enums.types';
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { RateLimitAPI } from '@security/rate-limit/rate-limit.decorator';
import { parseGeoPoint } from '@utils/in-person-flow.util';
import { InPersonCheckInService } from './in-person-check-in.service';
import { InPersonVisitService } from './in-person-visit.service';
import { InPersonDeskService } from './in-person-desk.service';
import { InPersonDeskFeesService } from './in-person-desk-fees.service';
import type { DeskFeesDue } from './desk-fees.util';
import { InPersonCheckInDto, InPersonWalkInDto } from './in-person.dto';
import { AppointmentResponseRedactionInterceptor } from '../core/appointment-response-redaction.interceptor';
import type {
  BookingLocation,
  InPersonActor,
  InPersonCheckInResult,
  InPersonDeskBoard,
  InPersonUndoNoShowResult,
  InPersonVisit,
  InPersonWalkInResult,
} from './in-person.types';

/**
 * A check-in / walk-in changes the patient's appointment list (GET /appointments/my-appointments
 * is cached 5 min with SWR) and the staff lists, so the patient's visit card flips to "checked
 * in" (token, queue) right after the call. Tags only: every one of those reads is registered in
 * these tag sets (clinic-scoped), so no keyspace SCAN runs per check-in. The desk board and
 * /in-person/me/today are not cached at all (DB + live queue lists).
 */
const CHECK_IN_CACHE_TAGS = [
  'appointments',
  'appointment_data',
  'appointment_details',
  'upcoming_appointments',
  'check_in',
  'my_appointments',
];

const PIPE = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

const STAFF_READERS: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.RECEPTIONIST,
  Role.CLINIC_ADMIN,
  Role.CLINIC_LOCATION_HEAD,
  Role.SUPER_ADMIN,
  Role.NURSE,
];

function clinicIdOf(req: ClinicAuthenticatedRequest): string {
  const clinicId = req.clinicContext?.clinicId;
  if (!clinicId) throw new BadRequestException('Clinic context is required');
  return clinicId;
}

function actorOf(req: ClinicAuthenticatedRequest): InPersonActor {
  const userId = String(req.user?.sub ?? req.user?.id ?? '');
  if (!userId) throw new BadRequestException('User context is required');
  return { userId, role: String(req.user?.role ?? '').toUpperCase() };
}

@ApiTags('in-person')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Clinic-ID', description: 'Clinic identifier', required: true })
@Controller('in-person')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@UseInterceptors(AppointmentResponseRedactionInterceptor)
@UsePipes(PIPE)
export class InPersonController {
  constructor(
    private readonly visits: InPersonVisitService,
    private readonly checkIns: InPersonCheckInService,
    private readonly deskActions: InPersonDeskService,
    private readonly deskFees: InPersonDeskFeesService
  ) {}

  @Get('locations')
  @Roles(Role.PATIENT, ...STAFF_READERS)
  @ApiOperation({ summary: 'Clinic locations for in-person booking, nearest first' })
  locations(
    @Query('lat') lat: string | undefined,
    @Query('lng') lng: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<BookingLocation[]> {
    return this.visits.listBookingLocations(clinicIdOf(req), parseGeoPoint(lat, lng));
  }

  @Get('me/today')
  @Roles(Role.PATIENT)
  @ApiOperation({ summary: "Caller's in-person bookings today (stage, token, ETA)" })
  mineToday(@Request() req: ClinicAuthenticatedRequest): Promise<InPersonVisit[]> {
    return this.visits.listMineToday(clinicIdOf(req), actorOf(req).userId);
  }

  @Get('appointments/:id')
  @Roles(Role.PATIENT, ...STAFF_READERS)
  @ApiOperation({ summary: 'One in-person visit: stage, token, people ahead, ETA' })
  visit(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<InPersonVisit> {
    return this.visits.getVisit(id, clinicIdOf(req), actorOf(req));
  }

  @Post('check-in')
  @HttpCode(HttpStatus.OK)
  @RateLimitAPI({ points: 20, duration: 60 })
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.CLINIC_LOCATION_HEAD)
  @InvalidateAppointmentCacheByTags(CHECK_IN_CACHE_TAGS)
  @ApiOperation({
    summary: 'Check a patient in (patient QR scan or reception one-click; one shared service)',
    description:
      'PATIENT with a typed desk code must send coordinates { lat, lng, accuracy? }: 400 LOCATION_REQUIRED without them, 403 TOO_FAR outside the location radius (+ GPS accuracy, capped at 1000 m). A scanned signed poster needs no coordinates.',
  })
  checkIn(
    @Body() dto: InPersonCheckInDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<InPersonCheckInResult> {
    return this.checkIns.checkIn(dto, clinicIdOf(req), actorOf(req));
  }

  @Post('walk-in')
  @HttpCode(HttpStatus.OK)
  @RateLimitAPI({ points: 30, duration: 60 })
  @Roles(Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.CLINIC_LOCATION_HEAD)
  @InvalidateAppointmentCacheByTags(CHECK_IN_CACHE_TAGS)
  @ApiOperation({
    summary:
      'Register a walk-in: in-person visit for now at the desk location, checked in (idempotent)',
  })
  walkIn(
    @Body() dto: InPersonWalkInDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<InPersonWalkInResult> {
    return this.deskActions.registerWalkIn(dto, clinicIdOf(req), actorOf(req));
  }

  @Post('appointments/:id/undo-no-show')
  @HttpCode(HttpStatus.OK)
  @RateLimitAPI({ points: 20, duration: 60 })
  @Roles(
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.CLINIC_LOCATION_HEAD,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE
  )
  @ApiOperation({ summary: 'Undo a no-show on the visit day (back in the queue if checked in)' })
  undoNoShow(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<InPersonUndoNoShowResult> {
    return this.deskActions.undoNoShow(id, clinicIdOf(req), actorOf(req));
  }

  @Get('desk/fees-due')
  @Roles(Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.CLINIC_LOCATION_HEAD, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: "Reception desk: unpaid desk fees (consultation bills) of the day's in-person visits",
  })
  feesDue(
    @Query('date') date: string | undefined,
    @Query('locationId') locationId: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<DeskFeesDue> {
    return this.deskFees.getFeesDue(clinicIdOf(req), actorOf(req), {
      ...(date ? { date } : {}),
      ...(locationId ? { locationId } : {}),
    });
  }

  @Get('desk')
  @Roles(Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.CLINIC_LOCATION_HEAD, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: "Reception desk: all of the location's in-person appointments for a day",
  })
  desk(
    @Query('date') date: string | undefined,
    @Query('locationId') locationId: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<InPersonDeskBoard> {
    // ?page=&limit= (optional): one page of visits; counts / total still cover the whole day.
    return this.visits.getDeskBoard(clinicIdOf(req), actorOf(req), {
      ...(date ? { date } : {}),
      ...(locationId ? { locationId } : {}),
      ...(page ? { page } : {}),
      ...(limit ? { limit } : {}),
    });
  }
}
