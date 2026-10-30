import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiBody,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { DayAvailabilityService, type DayAvailabilityActor } from '../day-availability.service';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { CreateDayOverrideDto, ListDayOverridesQueryDto } from '@dtos/doctor.dto';

/**
 * Dated OPD-window overrides for one doctor day (dynamic availability, L1).
 *
 * On top of a doctor's static weekly `Doctor.workingHours`, a doctor (or the clinic
 * admin) can override the OPD windows for a single calendar day — e.g. "30 Oct: open
 * only 12:00–15:00" or "closed for the day" (`sessions: []`) — with an emergency
 * reason. While an active override exists, the availability / slot grid for that
 * doctor+date uses the override's sessions instead of the weekly blocks, and every
 * booking / reschedule path inherits it because they all read the same lookup.
 *
 * These routes sit on the doctor-profile resource (`/doctors/.../day-availability`),
 * next to the working-hours profile edits. A DOCTOR manages only their own overrides;
 * a CLINIC_ADMIN manages any doctor of their clinic (the service enforces it).
 */
@ApiTags('doctors')
@Controller('doctors')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@ApiBearerAuth()
export class DayAvailabilityController {
  constructor(private readonly dayAvailabilityService: DayAvailabilityService) {}

  @Post(':doctorId/day-availability')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Create or replace a doctor day-availability override',
    description:
      'Override the OPD windows for one calendar day (or close the day with sessions: []). ' +
      'If an active override already exists for the same day / location it is superseded ' +
      '(replaced), not rejected. Body: { date, sessions, reason?, locationId? }.',
  })
  @ApiParam({
    name: 'doctorId',
    description: "The doctor's id (Doctor.id, or the doctor's User.id — the service resolves both)",
  })
  @ApiBody({ type: CreateDayOverrideDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Day override created (previous one superseded)',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid date / sessions / permissions',
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not allowed to edit this doctor' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Doctor not found in this clinic' })
  async createDayOverride(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Body() dto: CreateDayOverrideDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    return this.dayAvailabilityService.createDayOverride(
      {
        doctorId,
        date: dto.date,
        sessions: dto.sessions,
        ...(dto.reason != null && { reason: dto.reason }),
        ...(dto.locationId != null ? { locationId: dto.locationId } : {}),
      },
      this.actor(req)
    );
  }

  @Get(':doctorId/day-availability')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: "List a doctor's active day-availability overrides",
    description:
      'Active (non-cancelled) overrides for the doctor in the clinic, optionally bounded by ' +
      '?from&to (IST YYYY-MM-DD, inclusive). Without bounds: today through +31 days.',
  })
  @ApiParam({
    name: 'doctorId',
    description: "The doctor's id (Doctor.id, or the doctor's User.id)",
  })
  @ApiQuery({ type: () => ListDayOverridesQueryDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'Active day overrides (newest day last)' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not allowed to view this doctor' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Doctor not found in this clinic' })
  async listDayOverrides(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Query() query: ListDayOverridesQueryDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    return this.dayAvailabilityService.listDayOverrides(
      doctorId,
      this.clinicId(req),
      this.actor(req),
      query.from,
      query.to
    );
  }

  @Delete(':doctorId/day-availability/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Cancel (soft-delete) a doctor day-availability override',
    description:
      'Removes the dated override so the weekly workingHours apply again for that day. ' +
      'Returns the override with deleted: true.',
  })
  @ApiParam({
    name: 'doctorId',
    description: "The doctor's id (Doctor.id, or the doctor's User.id)",
  })
  @ApiParam({ name: 'id', description: 'The day-override id (from the list / create response)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Day override cancelled' })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: "Not allowed to cancel this doctor's override",
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Day override not found' })
  async cancelDayOverride(
    @Param('doctorId', ParseUUIDPipe) _doctorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // `doctorId` is in the URL for readability / the doctor-scoped cache tag; the service
    // authorizes against the override row's own doctor.
    return this.dayAvailabilityService.cancelDayOverride(id, this.clinicId(req), this.actor(req));
  }

  private clinicId(req: ClinicAuthenticatedRequest): string {
    return req.clinicContext?.clinicId ?? req.user?.clinicId ?? '';
  }

  private actor(req: ClinicAuthenticatedRequest): DayAvailabilityActor {
    return {
      userId: req.user?.id || req.user?.sub || '',
      role: req.user?.role || '',
      clinicId: this.clinicId(req),
    };
  }
}
