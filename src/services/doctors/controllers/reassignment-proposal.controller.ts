import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ReassignmentProposalService,
  ProposalApplyInput,
  type ReassignmentProposalResponse,
} from '../reassignment-proposal.service';
import { type DayAvailabilityActor } from '../day-availability.service';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { ApplyReassignmentProposalDto, ListReassignmentProposalsQueryDto } from '@dtos/doctor.dto';

/**
 * L3 review endpoints for doctor reassignment cascade proposals.
 *
 * When a doctor's OPD windows are removed for a day (L1 day override), the cascade either
 * auto-moves the affected not-yet-started visits to an open same-clinic provider or records
 * PENDING proposals here. These routes let the doctor (their own) or the clinic-admin (any
 * doctor of the clinic) list, apply (chosen target doctor / next-available-day), hold for
 * reception, or discard a proposal. RBAC mirrors the day-availability routes exactly.
 */
@ApiTags('doctors')
@Controller('doctors')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
@ApiBearerAuth()
export class ReassignmentProposalController {
  constructor(private readonly reassignmentProposalService: ReassignmentProposalService) {}

  @Get(':doctorId/reassignment-proposals')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'List doctor reassignment cascade proposals',
    description:
      "Proposals created when a day-availability override removed a doctor's OPD windows " +
      'and a not-yet-started visit could not be auto-moved. A doctor sees only their own; ' +
      'a clinic admin sees any of their clinic. ?status (default PENDING) and ?doctorId ' +
      'filter the list.',
  })
  @ApiParam({
    name: 'doctorId',
    description: "The doctor's id (Doctor.id, or the doctor's User.id)",
  })
  @RequireResourcePermission('appointments', 'read', {
    requireOwnership: false,
  })
  @ApiQuery({ type: () => ListReassignmentProposalsQueryDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Proposals (PENDING first), newest day last',
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not allowed to view this doctor' })
  async listReassignmentProposals(
    @Param('doctorId') doctorId: string,
    @Query() query: ListReassignmentProposalsQueryDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ReassignmentProposalResponse[]> {
    return this.reassignmentProposalService.listProposals(
      this.clinicId(req),
      this.actor(req),
      query.status,
      doctorId
    );
  }

  @Post(':doctorId/reassignment-proposals/:id/apply')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Confirm a PENDING reassignment proposal',
    description:
      'Either { doctorId } for a same-time move to the chosen provider (the existing reassign ' +
      'path) or { date, time } for a chosen day (the existing reschedule path). The proposal ' +
      'is marked APPLIED and the patient is notified through the existing reschedule-notify path.',
  })
  @ApiParam({ name: 'doctorId', description: "The proposal's doctor id (readability / cache tag)" })
  @ApiParam({ name: 'id', description: 'The proposal id (from the list)' })
  @ApiBody({ type: ApplyReassignmentProposalDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'Proposal applied' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Not PENDING, or the move is refused',
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not allowed to manage this doctor' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Proposal or appointment not found' })
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: false,
  })
  async applyReassignmentProposal(
    @Param('doctorId') _doctorId: string,
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) dto: ApplyReassignmentProposalDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ReassignmentProposalResponse> {
    const input: ProposalApplyInput = {
      ...(dto.doctorId != null ? { doctorId: dto.doctorId } : {}),
      ...(dto.date != null ? { date: dto.date, time: dto.time } : {}),
      ...(dto.notes != null ? { notes: dto.notes } : {}),
    };
    return this.reassignmentProposalService.applyProposal(
      id,
      this.clinicId(req),
      this.actor(req),
      input
    );
  }

  @Post(':doctorId/reassignment-proposals/:id/next-day')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Move the proposal to the next available slot of the same doctor',
    description:
      'The "no queue overflow" rule: the next open slot of the doctor is found through the ' +
      'shared availability seam (same time preferred, else the earliest open slot of the day, ' +
      '31-day horizon) and the visit is rebooked via the existing reschedule path. APPLIED.',
  })
  @ApiParam({ name: 'doctorId', description: "The proposal's doctor id" })
  @ApiParam({ name: 'id', description: 'The proposal id (from the list)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Proposal moved to the next available slot' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Not PENDING, or no open slot in the next 31 days',
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not allowed to manage this doctor' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Proposal or appointment not found' })
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: false,
  })
  async moveToNextAvailableDay(
    @Param('doctorId') _doctorId: string,
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ReassignmentProposalResponse> {
    return this.reassignmentProposalService.moveToNextAvailableDay(
      id,
      this.clinicId(req),
      this.actor(req)
    );
  }

  @Post(':doctorId/reassignment-proposals/:id/hold')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Defer the proposal to reception/admin',
    description:
      'Status DEFERRED; no patient move yet. The patient is notified that rescheduling is pending.',
  })
  @ApiParam({ name: 'doctorId', description: "The proposal's doctor id" })
  @ApiParam({ name: 'id', description: 'The proposal id (from the list)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Proposal deferred' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not allowed to manage this doctor' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Proposal not found' })
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: false,
  })
  async holdReassignmentProposal(
    @Param('doctorId') _doctorId: string,
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ReassignmentProposalResponse> {
    return this.reassignmentProposalService.holdProposal(id, this.clinicId(req), this.actor(req));
  }

  @Post(':doctorId/reassignment-proposals/:id/discard')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Discard the proposal (no patient move)',
    description: 'Status DISCARDED; the visit stays with the original doctor.',
  })
  @ApiParam({ name: 'doctorId', description: "The proposal's doctor id" })
  @ApiParam({ name: 'id', description: 'The proposal id (from the list)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Proposal discarded' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not allowed to manage this doctor' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Proposal not found' })
  @RequireResourcePermission('appointments', 'update', {
    requireOwnership: false,
  })
  async discardReassignmentProposal(
    @Param('doctorId') _doctorId: string,
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ReassignmentProposalResponse> {
    return this.reassignmentProposalService.discardProposal(
      id,
      this.clinicId(req),
      this.actor(req)
    );
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
