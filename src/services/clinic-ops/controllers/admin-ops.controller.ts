/**
 * Clinic-admin back-office endpoints (billing views and staff). Never reachable by DOCTOR /
 * ASSISTANT_DOCTOR.
 *   GET  /billing-ops/summary                      billed / collected / outstanding / overdue
 *   GET  /billing-ops/invoices/overdue             overdue invoices with reminder history
 *   GET  /billing-ops/invoices/:id/reminders
 *   POST /billing-ops/invoices/:id/reminders       WhatsApp / SMS reminder (en | mr | hi)
 *   GET  /billing-ops/invoices/:id/receipt         printable receipt data
 *   POST /staff-admin/invites                      invite staff (phone / email)
 *   GET  /staff-admin/invites
 *   POST /staff-admin/invites/:id/resend
 *   POST /staff-admin/invites/:id/revoke
 *   GET  /staff-admin/members                      all staff roles of the clinic
 *   GET  /staff-admin/members/:userId              staff detail
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
  BillingOpsService,
  type BillingSummaryResponse,
  type InvoiceReminderResponse,
  type OverdueInvoiceResponse,
  type ReceiptResponse,
} from '../services/billing-ops.service';
import {
  StaffAdminService,
  type StaffInviteResponse,
  type StaffMemberDetailResponse,
  type StaffMemberResponse,
} from '../services/staff-admin.service';
import { CreateStaffInviteDto, SendInvoiceReminderDto } from '../dto/clinic-ops.dto';
import { ADMIN_ROLES, actorOf, clinicIdOf } from './ops-request.util';

const PIPE = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
const BILLING_ROLES: Role[] = [Role.CLINIC_ADMIN, Role.FINANCE_BILLING, Role.SUPER_ADMIN];
const FRONT_DESK_BILLING_ROLES: Role[] = [...BILLING_ROLES, Role.RECEPTIONIST];

@ApiTags('billing-ops')
@ApiBearerAuth()
@Controller('billing-ops')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@UsePipes(PIPE)
export class BillingOpsController {
  constructor(private readonly billingOps: BillingOpsService) {}

  @Get('summary')
  @Roles(...BILLING_ROLES)
  @ApiOperation({ summary: 'Billing summary for a period (default: this month)' })
  summary(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<BillingSummaryResponse> {
    return this.billingOps.summary(clinicIdOf(req), from, to);
  }

  @Get('invoices/overdue')
  @Roles(...FRONT_DESK_BILLING_ROLES)
  @ApiOperation({ summary: 'Overdue invoices with reminder history' })
  overdue(
    @Query('limit') limit: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<OverdueInvoiceResponse[]> {
    return this.billingOps.listOverdue(
      clinicIdOf(req),
      limit && Number.isFinite(Number(limit)) ? Number(limit) : undefined
    );
  }

  @Get('invoices/:id/reminders')
  @Roles(...FRONT_DESK_BILLING_ROLES)
  @ApiOperation({ summary: 'Reminders sent for an invoice' })
  reminders(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<InvoiceReminderResponse[]> {
    return this.billingOps.listReminders(id, clinicIdOf(req));
  }

  @Post('invoices/:id/reminders')
  @Roles(...FRONT_DESK_BILLING_ROLES)
  @ApiOperation({ summary: 'Send (or schedule) a payment reminder for an unpaid invoice' })
  sendReminder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendInvoiceReminderDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<InvoiceReminderResponse> {
    return this.billingOps.sendReminder(id, dto, clinicIdOf(req), actorOf(req));
  }

  @Get('invoices/:id/receipt')
  @Roles(...FRONT_DESK_BILLING_ROLES)
  @ApiOperation({ summary: 'Receipt data for printing / sharing' })
  receipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ReceiptResponse> {
    return this.billingOps.receipt(id, clinicIdOf(req));
  }
}

@ApiTags('staff-admin')
@ApiBearerAuth()
@Controller('staff-admin')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@UsePipes(PIPE)
export class StaffAdminController {
  constructor(private readonly staffAdmin: StaffAdminService) {}

  @Post('invites')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Invite a staff member by phone or email' })
  invite(
    @Body() dto: CreateStaffInviteDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<StaffInviteResponse> {
    return this.staffAdmin.createInvite(dto, clinicIdOf(req), actorOf(req));
  }

  @Get('invites')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Staff invitations' })
  invites(
    @Query('status') status: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<StaffInviteResponse[]> {
    return this.staffAdmin.listInvites(clinicIdOf(req), status);
  }

  @Post('invites/:id/resend')
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Resend an invitation with a fresh link' })
  resend(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<StaffInviteResponse> {
    return this.staffAdmin.resendInvite(id, clinicIdOf(req), actorOf(req));
  }

  @Post('invites/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Revoke an invitation' })
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<StaffInviteResponse> {
    return this.staffAdmin.revokeInvite(id, clinicIdOf(req), actorOf(req));
  }

  @Get('members')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Staff of the clinic (all roles)' })
  members(
    @Query('role') role: string | undefined,
    @Query('q') q: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<StaffMemberResponse[]> {
    return this.staffAdmin.listMembers(clinicIdOf(req), {
      ...(role ? { role } : {}),
      ...(q ? { q } : {}),
    });
  }

  @Get('members/:userId')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Staff detail' })
  member(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<StaffMemberDetailResponse> {
    return this.staffAdmin.getMember(userId, clinicIdOf(req));
  }
}
