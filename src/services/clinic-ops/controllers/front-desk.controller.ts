/**
 * Front-desk / admin operations on check-ins and the live queue.
 *   GET  /check-in-log                         attempt log (date | from,to, locationId, outcome, method)
 *   GET  /check-in-log/failed                  unresolved failed attempts (default today)
 *   GET  /check-in-log/summary                 counts for the day
 *   POST /check-in-log/:id/resolve             MANUAL_CHECK_IN | CALLED | IGNORED
 *   POST /queue-ops/appointments/:appointmentId/priority   SENIOR | PREGNANT | EMERGENCY | NORMAL
 * Calling / starting / completing a visit is NOT here: those stay doctor-only in /queue and /appointments.
 */

import {
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
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import {
  CheckInLogService,
  type CheckInAttemptResponse,
  type CheckInLogSummary,
} from '../services/check-in-log.service';
import { QueueOpsService, type QueuePriorityResponse } from '../services/queue-ops.service';
import { ResolveCheckInAttemptDto, SetQueuePriorityDto } from '../dto/clinic-ops.dto';
import { actorOf, clinicIdOf } from './ops-request.util';

const PIPE = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
const LOG_ROLES: Role[] = [
  Role.CLINIC_ADMIN,
  Role.RECEPTIONIST,
  Role.CLINIC_LOCATION_HEAD,
  Role.SUPER_ADMIN,
];

@ApiTags('check-in-log')
@ApiBearerAuth()
@Controller('check-in-log')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@UsePipes(PIPE)
export class CheckInLogController {
  constructor(private readonly checkInLog: CheckInLogService) {}

  @Get()
  @Roles(...LOG_ROLES)
  @ApiOperation({ summary: 'Check-in / QR scan log' })
  async list(
    @Query('date') date: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('locationId') locationId: string | undefined,
    @Query('outcome') outcome: string | undefined,
    @Query('method') method: string | undefined,
    @Query('limit') limit: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<CheckInAttemptResponse[]> {
    const clinicId = clinicIdOf(req);
    const scoped = await this.checkInLog.locationScope(actorOf(req), clinicId, locationId);
    return this.checkInLog.list(clinicId, {
      ...(date ? { date } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(scoped ? { locationId: scoped } : {}),
      ...(outcome ? { outcome } : {}),
      ...(method ? { method } : {}),
      ...(limit && Number.isFinite(Number(limit)) ? { limit: Number(limit) } : {}),
    });
  }

  @Get('failed')
  @Roles(...LOG_ROLES)
  @ApiOperation({ summary: 'Failed check-ins that still need attention' })
  async failed(
    @Query('date') date: string | undefined,
    @Query('locationId') locationId: string | undefined,
    @Query('includeResolved') includeResolved: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<CheckInAttemptResponse[]> {
    const clinicId = clinicIdOf(req);
    const scoped = await this.checkInLog.locationScope(actorOf(req), clinicId, locationId);
    return this.checkInLog.listFailed(clinicId, {
      ...(date ? { date } : {}),
      ...(scoped ? { locationId: scoped } : {}),
      includeResolved: includeResolved === 'true',
    });
  }

  @Get('summary')
  @Roles(...LOG_ROLES)
  @ApiOperation({ summary: 'Check-in counts for a day' })
  async summary(
    @Query('date') date: string | undefined,
    @Query('locationId') locationId: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<CheckInLogSummary> {
    const clinicId = clinicIdOf(req);
    const scoped = await this.checkInLog.locationScope(actorOf(req), clinicId, locationId);
    return this.checkInLog.summary(clinicId, date, scoped);
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @Roles(...LOG_ROLES)
  @ApiOperation({ summary: 'Mark a failed check-in as handled' })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveCheckInAttemptDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<CheckInAttemptResponse> {
    return this.checkInLog.resolve(id, dto, clinicIdOf(req), actorOf(req));
  }
}

@ApiTags('queue-ops')
@ApiBearerAuth()
@Controller('queue-ops')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@UsePipes(PIPE)
export class QueueOpsController {
  constructor(private readonly queueOps: QueueOpsService) {}

  @Post('appointments/:appointmentId/priority')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Raise or clear the queue priority of a patient' })
  setPriority(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: SetQueuePriorityDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<QueuePriorityResponse> {
    return this.queueOps.setPriority(appointmentId, dto, clinicIdOf(req), actorOf(req));
  }
}
