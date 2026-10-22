/**
 * Round-3 endpoints that sit outside the clinic-admin / assistant core.
 *
 * Pharmacy (PHARMACIST, CLINIC_ADMIN):
 *   POST /pharmacy-ops/prescriptions/:id/handover/code     PATIENT: issue the 6-digit code + QR text
 *   GET  /pharmacy-ops/prescriptions/:id/handover          latest hand-over of the prescription
 *   POST /pharmacy-ops/prescriptions/:id/handover/verify   check the code the patient shows
 *   POST /pharmacy-ops/handovers/:id/confirm               checklist + receiver + signature
 *   POST /pharmacy-ops/handovers/:id/undo                  inside the undo window
 *   GET  /pharmacy-ops/batches/:id/audit                   batch movement trail
 *   POST /pharmacy-ops/batches/:id/return-to-supplier
 *   POST /pharmacy-ops/batches/:id/discard
 * Patient app:
 *   GET  /lab-bookings/packages | POST /lab-bookings | GET /lab-bookings/mine | POST /lab-bookings/:id/cancel
 *   GET  /lab-bookings (front desk / admin) | PATCH /lab-bookings/:id/status
 *   GET  /support/thread | POST /support/messages (patient) ; GET /support/threads | GET /support/threads/:id | POST /support/threads/:id/reply (staff)
 * Doctor:
 *   POST/GET /investigations, PATCH /investigations/:id/status
 *   GET/PUT/DELETE /doctor-favourites (per account)
 *   GET /clinic-audit (clinic admin)
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { RateLimitAPI } from '@security/rate-limit/rate-limit.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import {
  HandoverService,
  type HandoverCodeResponse,
  type HandoverResponse,
} from '../services/handover.service';
import {
  BatchActionsService,
  type BatchActionResponse,
  type BatchAuditEntry,
} from '../services/batch-actions.service';
import {
  PatientOpsService,
  type LabBookingResponse,
  type SupportThreadResponse,
} from '../services/patient-ops.service';
import {
  DoctorOpsService,
  type FavouriteResponse,
  type InvestigationResponse,
} from '../services/doctor-ops.service';
import { ClinicAuditService, type AuditEventResponse } from '../services/audit.service';
import {
  BatchActionDto,
  BulkFavouritesDto,
  ConfirmHandoverDto,
  CreateInvestigationOrderDto,
  CreateLabBookingDto,
  SendSupportMessageDto,
  StaffSupportReplyDto,
  UpdateInvestigationStatusDto,
  UpdateLabBookingStatusDto,
  UpsertFavouriteDto,
  VerifyHandoverDto,
} from '../dto/clinic-ops.dto';
import { actorOf, ADMIN_ROLES, clinicIdOf } from './ops-request.util';

const PIPE = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
const COUNTER_ROLES: Role[] = [Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN];

@ApiTags('pharmacy-ops')
@ApiBearerAuth()
@Controller('pharmacy-ops')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@UsePipes(PIPE)
export class PharmacyOpsController {
  constructor(
    private readonly handovers: HandoverService,
    private readonly batches: BatchActionsService
  ) {}

  @Post('prescriptions/:id/handover/code')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT)
  @ApiOperation({ summary: 'Patient: show a one-time code / QR to collect medicines' })
  issueCode(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<HandoverCodeResponse> {
    return this.handovers.issueCode(id, clinicIdOf(req), actorOf(req));
  }

  @Get('prescriptions/:id/handover')
  @Roles(...COUNTER_ROLES)
  @ApiOperation({ summary: 'Latest hand-over of a prescription (null when none)' })
  async latest(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<HandoverResponse | null> {
    return this.handovers.latestForPrescription(id, clinicIdOf(req));
  }

  @Post('prescriptions/:id/handover/verify')
  @HttpCode(HttpStatus.OK)
  @Roles(...COUNTER_ROLES)
  @RateLimitAPI({ points: 20, duration: 60 }) // per-row attempts are capped too; this stops sweeps
  @ApiOperation({ summary: 'Verify the code / QR the patient shows at the counter' })
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyHandoverDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<HandoverResponse> {
    return this.handovers.verify(id, dto, clinicIdOf(req), actorOf(req));
  }

  @Post('handovers/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @Roles(...COUNTER_ROLES)
  @ApiOperation({ summary: 'Confirm the hand-over (item checklist, receiver, signature)' })
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmHandoverDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<HandoverResponse> {
    return this.handovers.confirm(id, dto, clinicIdOf(req), actorOf(req));
  }

  @Post('handovers/:id/undo')
  @HttpCode(HttpStatus.OK)
  @Roles(...COUNTER_ROLES)
  @ApiOperation({ summary: 'Undo a hand-over inside the undo window' })
  undo(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<HandoverResponse> {
    return this.handovers.undo(id, clinicIdOf(req), actorOf(req));
  }

  @Get('batches/:id/audit')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Every stock movement of a batch' })
  trail(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<BatchAuditEntry[]> {
    return this.batches.trail(id, clinicIdOf(req));
  }

  @Post('batches/:id/return-to-supplier')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Return (part of) a batch to the supplier' })
  returnToSupplier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BatchActionDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<BatchActionResponse> {
    return this.batches.returnToSupplier(id, dto, clinicIdOf(req), actorOf(req));
  }

  @Post('batches/:id/discard')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Discard (part of) a batch' })
  discard(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BatchActionDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<BatchActionResponse> {
    return this.batches.discard(id, dto, clinicIdOf(req), actorOf(req));
  }
}

@ApiTags('lab-bookings')
@ApiBearerAuth()
@Controller('lab-bookings')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@UsePipes(PIPE)
export class LabBookingController {
  constructor(private readonly patientOps: PatientOpsService) {}

  @Get('packages')
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Home lab packages and slot windows' })
  packages(): ReturnType<PatientOpsService['packages']> {
    return this.patientOps.packages();
  }

  @Post()
  @Roles(Role.PATIENT)
  @ApiOperation({ summary: 'Book a home lab test / checkup' })
  create(
    @Body() dto: CreateLabBookingDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<LabBookingResponse> {
    return this.patientOps.createLabBooking(dto, clinicIdOf(req), actorOf(req));
  }

  @Get('mine')
  @Roles(Role.PATIENT)
  @ApiOperation({ summary: 'My lab bookings' })
  mine(@Request() req: ClinicAuthenticatedRequest): Promise<LabBookingResponse[]> {
    return this.patientOps.myLabBookings(clinicIdOf(req), actorOf(req));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT)
  @ApiOperation({ summary: 'Cancel my lab booking' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<LabBookingResponse> {
    return this.patientOps.cancelLabBooking(id, clinicIdOf(req), actorOf(req));
  }

  @Get()
  @Roles(Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.LAB_TECHNICIAN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'All lab bookings of the clinic' })
  list(
    @Query('status') status: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<LabBookingResponse[]> {
    return this.patientOps.listLabBookings(clinicIdOf(req), status);
  }

  @Patch(':id/status')
  @Roles(Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.LAB_TECHNICIAN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Move a lab booking along (confirmed, sample collected, completed)' })
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLabBookingStatusDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<LabBookingResponse> {
    return this.patientOps.setLabBookingStatus(id, dto, clinicIdOf(req), actorOf(req));
  }
}

@ApiTags('support')
@ApiBearerAuth()
@Controller('support')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@UsePipes(PIPE)
export class SupportController {
  constructor(private readonly patientOps: PatientOpsService) {}

  @Get('thread')
  @Roles(Role.PATIENT)
  @ApiOperation({ summary: 'My help-chat thread (created on first use)' })
  thread(@Request() req: ClinicAuthenticatedRequest): Promise<SupportThreadResponse> {
    return this.patientOps.myThread(clinicIdOf(req), actorOf(req));
  }

  @Post('messages')
  @Roles(Role.PATIENT)
  @ApiOperation({ summary: 'Send a help-chat message (optionally a quick reply chip)' })
  send(
    @Body() dto: SendSupportMessageDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<SupportThreadResponse> {
    return this.patientOps.sendMessage(dto, clinicIdOf(req), actorOf(req));
  }

  @Get('threads')
  @Roles(Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Open help-chat threads (front desk)' })
  threads(@Request() req: ClinicAuthenticatedRequest): Promise<SupportThreadResponse[]> {
    return this.patientOps.listThreads(clinicIdOf(req));
  }

  @Get('threads/:id')
  @Roles(Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'One help-chat thread with its full history (front desk)' })
  staffThread(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<SupportThreadResponse> {
    return this.patientOps.staffThread(id, clinicIdOf(req));
  }

  @Post('threads/:id/reply')
  @Roles(Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Staff reply in a help-chat thread' })
  reply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StaffSupportReplyDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<SupportThreadResponse> {
    return this.patientOps.staffReply(id, dto, clinicIdOf(req), actorOf(req));
  }
}

@ApiTags('doctor-ops')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@UsePipes(PIPE)
export class DoctorOpsController {
  constructor(
    private readonly doctorOps: DoctorOpsService,
    private readonly audit: ClinicAuditService
  ) {}

  @Post('investigations')
  @Roles(Role.DOCTOR)
  @ApiOperation({ summary: 'Order lab / imaging investigations (doctor only)' })
  order(
    @Body() dto: CreateInvestigationOrderDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<InvestigationResponse> {
    return this.doctorOps.createInvestigation(dto, clinicIdOf(req), actorOf(req));
  }

  @Get('investigations')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.LAB_TECHNICIAN, Role.CLINIC_ADMIN, Role.PATIENT)
  @ApiOperation({ summary: 'Investigation orders (patients see their own)' })
  listOrders(
    @Query('patientId') patientId: string | undefined,
    @Query('status') status: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<InvestigationResponse[]> {
    return this.doctorOps.listInvestigations(clinicIdOf(req), actorOf(req), {
      ...(patientId ? { patientId } : {}),
      ...(status ? { status } : {}),
    });
  }

  @Patch('investigations/:id/status')
  @Roles(Role.DOCTOR, Role.LAB_TECHNICIAN, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Update the status of an investigation order' })
  setOrderStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvestigationStatusDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<InvestigationResponse> {
    return this.doctorOps.setInvestigationStatus(id, dto, clinicIdOf(req), actorOf(req));
  }

  @Get('doctor-favourites')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR)
  @ApiOperation({ summary: 'My favourites (quick Rx medicines, templates, diagnoses ...)' })
  favourites(
    @Query('kind') kind: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<FavouriteResponse[]> {
    return this.doctorOps.listFavourites(actorOf(req), kind);
  }

  @Put('doctor-favourites')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR)
  @ApiOperation({ summary: 'Add or update one favourite (idempotent on kind + itemKey)' })
  upsert(
    @Body() dto: UpsertFavouriteDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<FavouriteResponse> {
    return this.doctorOps.upsertFavourite(dto, clinicIdOf(req), actorOf(req));
  }

  @Put('doctor-favourites/bulk')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR)
  @ApiOperation({ summary: 'Import the device-local favourites once; returns the full list' })
  bulk(
    @Body() dto: BulkFavouritesDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<FavouriteResponse[]> {
    return this.doctorOps.bulkUpsert(dto, clinicIdOf(req), actorOf(req));
  }

  @Delete('doctor-favourites/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR)
  @ApiOperation({ summary: 'Remove a favourite' })
  removeFavourite(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<{ id: string; deleted: boolean }> {
    return this.doctorOps.removeFavourite(id, clinicIdOf(req), actorOf(req));
  }

  @Get('clinic-audit')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({
    summary: 'Audit trail of operational actions (priority, leave, refunds, QR ...)',
  })
  auditTrail(
    @Query('entityType') entityType: string | undefined,
    @Query('entityId') entityId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('limit') limit: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<AuditEventResponse[]> {
    return this.audit.list(clinicIdOf(req), {
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(limit && Number.isFinite(Number(limit)) ? { limit: Number(limit) } : {}),
    });
  }
}
