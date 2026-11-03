/**
 * Assistant-doctor workflow endpoints (no billing amounts for the clinical roles).
 *   GET  /rx-drafts                         doctor: drafts awaiting approval; assistant: own drafts (+ returned)
 *   GET  /rx-drafts?status=APPROVED&days=30 recently approved drafts (history)
 *   GET  /rx-drafts/:id
 *   POST /rx-drafts/:id/approve             DOCTOR only
 *   POST /rx-drafts/:id/return              DOCTOR only  { note }
 *   POST /rx-drafts/:id/resubmit            ASSISTANT_DOCTOR (own draft) { note? }
 *   POST /rx-drafts/:id/discard             ASSISTANT_DOCTOR (own) | DOCTOR
 *   GET  /direct-dispense/stock             stock view (read-only; prices only for billing roles)
 *   POST /direct-dispense                   dispense from clinic stock (FEFO)
 *   GET  /direct-dispense                   hand-overs (clinical roles: only their own)
 *   GET  /direct-dispense/:id
 *   POST /direct-dispense/:id/undo          dispenser, inside the undo window
 *   POST /direct-dispense/:id/reverse       clinic admin / pharmacist, any time, with a reason
 *   POST /direct-dispense/:id/settle        clinic admin / pharmacist / finance (records only)
 * Drafts are created and edited through the normal prescription endpoints: when an ASSISTANT_DOCTOR
 * creates a prescription it is stored as DRAFT.
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
import { RxDraftService, type RxDraftResponse } from '../services/rx-draft.service';
import {
  DirectDispenseService,
  type DirectDispenseResponse,
  type StockViewItem,
} from '../services/direct-dispense.service';
import {
  CreateDirectDispenseDto,
  ResubmitRxDraftDto,
  ReturnRxDraftDto,
  ReverseDirectDispenseDto,
  SettleDirectDispenseDto,
} from '../dto/clinic-ops.dto';
import { actorOf, clinicIdOf } from './ops-request.util';

const PIPE = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

@ApiTags('rx-drafts')
@ApiBearerAuth()
@Controller('rx-drafts')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@UsePipes(PIPE)
export class RxDraftController {
  constructor(private readonly drafts: RxDraftService) {}

  @Get()
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR)
  @ApiOperation({ summary: 'Prescription drafts (doctor: to approve; assistant: own + returned)' })
  list(
    @Query('status') status: string | undefined,
    @Query('days') days: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<RxDraftResponse[]> {
    return this.drafts.list(
      clinicIdOf(req),
      actorOf(req),
      status,
      days && Number.isFinite(Number(days)) ? Number(days) : undefined
    );
  }

  @Get(':id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR)
  @ApiOperation({ summary: 'One draft prescription' })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<RxDraftResponse> {
    return this.drafts.get(id, clinicIdOf(req), actorOf(req));
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR)
  @ApiOperation({ summary: 'Doctor approves a draft: it becomes a normal pending prescription' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<RxDraftResponse> {
    return this.drafts.approve(id, clinicIdOf(req), actorOf(req));
  }

  @Post(':id/return')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR)
  @ApiOperation({ summary: 'Doctor returns a draft to the assistant with a change note' })
  returnDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnRxDraftDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<RxDraftResponse> {
    return this.drafts.returnDraft(id, dto, clinicIdOf(req), actorOf(req));
  }

  @Post(':id/resubmit')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ASSISTANT_DOCTOR)
  @ApiOperation({ summary: 'Assistant resubmits a returned draft after fixing it' })
  resubmit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResubmitRxDraftDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<RxDraftResponse> {
    return this.drafts.resubmit(id, clinicIdOf(req), actorOf(req), dto?.note);
  }

  @Post(':id/discard')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR)
  @ApiOperation({ summary: 'Discard a draft that will not be used' })
  discard(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<{ id: string; status: string }> {
    return this.drafts.discard(id, clinicIdOf(req), actorOf(req));
  }
}

const DISPENSE_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.PHARMACIST,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];
const REVERSE_ROLES: Role[] = [Role.CLINIC_ADMIN, Role.PHARMACIST, Role.SUPER_ADMIN];
const SETTLE_ROLES: Role[] = [
  Role.CLINIC_ADMIN,
  Role.PHARMACIST,
  Role.FINANCE_BILLING,
  Role.SUPER_ADMIN,
];

@ApiTags('direct-dispense')
@ApiBearerAuth()
@Controller('direct-dispense')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@UsePipes(PIPE)
export class DirectDispenseController {
  constructor(private readonly dispenses: DirectDispenseService) {}

  @Get('stock')
  @Roles(...DISPENSE_ROLES, Role.NURSE)
  @ApiOperation({ summary: 'Clinic stock view (read-only)' })
  stock(
    @Query('q') q: string | undefined,
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('page') page: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<{
    items: StockViewItem[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  }> {
    return this.dispenses.stockView(clinicIdOf(req), actorOf(req), {
      ...(q ? { q } : {}),
      ...(status ? { status } : {}),
      ...(limit && Number.isFinite(Number(limit)) ? { limit: Number(limit) } : {}),
      ...(page && Number.isFinite(Number(page)) ? { page: Number(page) } : {}),
    });
  }

  @Post()
  @Roles(...DISPENSE_ROLES)
  @ApiOperation({ summary: 'Dispense medicines from clinic stock' })
  create(
    @Body() dto: CreateDirectDispenseDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<DirectDispenseResponse> {
    return this.dispenses.create(dto, clinicIdOf(req), actorOf(req));
  }

  @Get()
  @Roles(...DISPENSE_ROLES)
  @ApiOperation({ summary: 'Direct dispense history' })
  list(
    @Query('status') status: string | undefined,
    @Query('patientId') patientId: string | undefined,
    @Query('mine') mine: string | undefined,
    @Query('limit') limit: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<DirectDispenseResponse[]> {
    return this.dispenses.list(clinicIdOf(req), actorOf(req), {
      ...(status ? { status } : {}),
      ...(patientId ? { patientId } : {}),
      mine: mine === 'true',
      ...(limit && Number.isFinite(Number(limit)) ? { limit: Number(limit) } : {}),
    });
  }

  @Get(':id')
  @Roles(...DISPENSE_ROLES)
  @ApiOperation({ summary: 'One direct dispense' })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<DirectDispenseResponse> {
    return this.dispenses.get(id, clinicIdOf(req), actorOf(req));
  }

  @Post(':id/undo')
  @HttpCode(HttpStatus.OK)
  @Roles(...DISPENSE_ROLES)
  @ApiOperation({ summary: 'Undo your own hand-over inside the undo window' })
  undo(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<DirectDispenseResponse> {
    return this.dispenses.undo(id, clinicIdOf(req), actorOf(req));
  }

  @Post(':id/reverse')
  @HttpCode(HttpStatus.OK)
  @Roles(...REVERSE_ROLES)
  @ApiOperation({ summary: 'Reverse a hand-over and return the stock (admin / pharmacist)' })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseDirectDispenseDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<DirectDispenseResponse> {
    return this.dispenses.reverse(id, dto, clinicIdOf(req), actorOf(req));
  }

  @Post(':id/settle')
  @HttpCode(HttpStatus.OK)
  @Roles(...SETTLE_ROLES)
  @ApiOperation({ summary: 'Record how a direct dispense was settled (no payment is processed)' })
  settle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SettleDirectDispenseDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<DirectDispenseResponse> {
    return this.dispenses.settle(id, dto, clinicIdOf(req), actorOf(req));
  }
}
