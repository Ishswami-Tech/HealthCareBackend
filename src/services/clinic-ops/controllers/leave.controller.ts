/**
 * Leave & holiday endpoints.
 *   POST   /leave-requests                    any staff: request leave / half day / break
 *   GET    /leave-requests/mine               any staff: own requests
 *   GET    /leave-requests                    clinic admin: all requests (status, from, to, userId)
 *   GET    /leave-requests/:id/impact         clinic admin: appointments affected by a leave
 *   POST   /leave-requests/:id/approve        clinic admin
 *   POST   /leave-requests/:id/decline        clinic admin
 *   POST   /leave-requests/:id/cancel         requester or clinic admin
 *   GET    /clinic-holidays                   all staff + patients (calendar / booking)
 *   POST   /clinic-holidays                   clinic admin
 *   PATCH  /clinic-holidays/:id               clinic admin
 *   DELETE /clinic-holidays/:id               clinic admin
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
  LeaveService,
  type ClinicHolidayResponse,
  type LeaveImpactResponse,
  type LeaveRequestResponse,
} from '../services/leave.service';
import {
  CreateClinicHolidayDto,
  CreateLeaveRequestDto,
  DecideLeaveRequestDto,
  UpdateClinicHolidayDto,
} from '../dto/clinic-ops.dto';
import { ADMIN_ROLES, ALL_STAFF_ROLES, actorOf, clinicIdOf } from './ops-request.util';

const PIPE = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

@ApiTags('leave')
@ApiBearerAuth()
@Controller('leave-requests')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@UsePipes(PIPE)
export class LeaveController {
  constructor(private readonly leaveService: LeaveService) {}

  @Post()
  @Roles(...ALL_STAFF_ROLES)
  @ApiOperation({ summary: 'Request leave, a half day or a break' })
  create(
    @Body() dto: CreateLeaveRequestDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<LeaveRequestResponse> {
    return this.leaveService.createRequest(dto, clinicIdOf(req), actorOf(req));
  }

  @Get('mine')
  @Roles(...ALL_STAFF_ROLES)
  @ApiOperation({ summary: 'My leave requests' })
  mine(@Request() req: ClinicAuthenticatedRequest): Promise<LeaveRequestResponse[]> {
    return this.leaveService.listMine(clinicIdOf(req), actorOf(req));
  }

  @Get()
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'All leave requests of the clinic (approval queue)' })
  listAll(
    @Query('status') status: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('userId') userId: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<LeaveRequestResponse[]> {
    return this.leaveService.listForAdmin(clinicIdOf(req), {
      ...(status ? { status } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(userId ? { userId } : {}),
    });
  }

  @Get(':id/impact')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Booked appointments that fall inside a leave request' })
  impact(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<LeaveImpactResponse> {
    return this.leaveService.getImpact(id, clinicIdOf(req));
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Approve a leave request (blocks the calendar for doctor leave)' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLeaveRequestDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<LeaveRequestResponse> {
    return this.leaveService.decide(id, clinicIdOf(req), 'APPROVED', dto, actorOf(req));
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Decline a leave request' })
  decline(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLeaveRequestDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<LeaveRequestResponse> {
    return this.leaveService.decide(id, clinicIdOf(req), 'DECLINED', dto, actorOf(req));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(...ALL_STAFF_ROLES)
  @ApiOperation({ summary: 'Cancel a pending / approved leave request' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<LeaveRequestResponse> {
    return this.leaveService.cancel(id, clinicIdOf(req), actorOf(req));
  }
}

@ApiTags('leave')
@ApiBearerAuth()
@Controller('clinic-holidays')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@UsePipes(PIPE)
export class ClinicHolidaysController {
  constructor(private readonly leaveService: LeaveService) {}

  @Get()
  @Roles(...ALL_STAFF_ROLES, Role.PATIENT, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Holidays, closures and doctor leave on the clinic calendar' })
  list(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('locationId') locationId: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ClinicHolidayResponse[]> {
    return this.leaveService.listHolidays(clinicIdOf(req), {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(locationId ? { locationId } : {}),
    });
  }

  @Post()
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Add a holiday / closure' })
  create(
    @Body() dto: CreateClinicHolidayDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ClinicHolidayResponse> {
    return this.leaveService.createHoliday(dto, clinicIdOf(req), actorOf(req));
  }

  @Patch(':id')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Edit a holiday / closure' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClinicHolidayDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ClinicHolidayResponse> {
    return this.leaveService.updateHoliday(id, dto, clinicIdOf(req), actorOf(req));
  }

  @Delete(':id')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Remove a holiday / closure' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<{ id: string }> {
    return this.leaveService.deleteHoliday(id, clinicIdOf(req), actorOf(req));
  }
}
