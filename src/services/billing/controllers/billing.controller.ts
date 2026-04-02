import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Request,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { FastifyReply } from 'fastify';
import * as fs from 'fs';
import { BillingService } from '@services/billing/billing.service';
import { InvoicePDFService } from '@services/billing/invoice-pdf.service';
import { QueueService } from '@queue/src/queue.service';
import { JobType, JobPriorityLevel } from '@core/types/queue.types';
import {
  CreateBillingPlanDto,
  UpdateBillingPlanDto,
  CreateSubscriptionDto,
  UpdateSubscriptionDto,
  CreatePaymentDto,
  UpdatePaymentDto,
  CreateInvoiceDto,
  UpdateInvoiceDto,
  CreateClinicExpenseDto,
  CreateInsuranceClaimDto,
  UpdateInsuranceClaimDto,
  CreateInPersonSubscriptionAppointmentDto,
} from '@dtos/billing.dto';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { ProfileCompletionGuard } from '@core/guards/profile-completion.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { RequiresProfileCompletion } from '@core/decorators/profile-completion.decorator';

import { Cache } from '@core/decorators';
import { RateLimitAPI } from '@security/rate-limit/rate-limit.decorator';
import { Role } from '@core/types/enums.types';
import type { AuthenticatedRequest } from '@core/types';
import { PaymentProvider } from '@core/types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { AppointmentType } from '@dtos/appointment.dto';

type AppointmentServiceResult = {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  message?: string;
  metadata?: Record<string, unknown>;
};

type AppointmentsServiceLike = {
  createAppointment: (
    payload: Record<string, unknown>,
    userId: string,
    clinicId: string,
    role: string,
    options?: {
      skipInPersonSubscriptionAutoLink?: boolean;
    }
  ) => Promise<AppointmentServiceResult>;
  cancelAppointment: (
    appointmentId: string,
    reason: string,
    userId: string,
    clinicId: string,
    role: string
  ) => Promise<unknown>;
};

@ApiTags('billing')
@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard, ProfileCompletionGuard)
@RequiresProfileCompletion()
export class BillingController {
  private appointmentsServiceRef: AppointmentsServiceLike | null = null;

  constructor(
    private readonly billingService: BillingService,
    private readonly invoicePDFService: InvoicePDFService,
    private readonly queueService: QueueService,
    private readonly moduleRef: ModuleRef
  ) {}

  private getAppointmentsService(): AppointmentsServiceLike {
    if (!this.appointmentsServiceRef) {
      this.appointmentsServiceRef = this.moduleRef.get<AppointmentsServiceLike>(
        'APPOINTMENTS_SERVICE',
        { strict: false }
      );
    }
    if (!this.appointmentsServiceRef) {
      throw new Error('APPOINTMENTS_SERVICE is not available');
    }
    return this.appointmentsServiceRef;
  }

  private parsePaymentProvider(provider?: string): PaymentProvider | undefined {
    if (!provider) {
      return undefined;
    }

    const normalizedProvider = provider.trim().toLowerCase();
    const enabledProviders = (process.env['PAYMENT_ENABLED_PROVIDERS'] || PaymentProvider.CASHFREE)
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean);

    if (!enabledProviders.includes(normalizedProvider)) {
      throw new BadRequestException(
        `Payment provider '${provider}' is not enabled. Enabled providers: ${enabledProviders.join(', ')}`
      );
    }

    return normalizedProvider as PaymentProvider;
  }

  // ============ Billing Plans ============

  @Get('plans')
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.FINANCE_BILLING,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.RECEPTIONIST,
    Role.NURSE,
    Role.PHARMACIST,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.LAB_TECHNICIAN,
    Role.SUPPORT_STAFF,
    Role.CLINIC_LOCATION_HEAD,
    Role.PATIENT
  )
  @RequireResourcePermission('billing', 'read')
  @Cache({
    keyTemplate: 'billing:plans:{clinicId}',
    ttl: 3600, // 1 hour
    tags: ['billing', 'billing_plans'],
    enableSWR: true,
  })
  @RateLimitAPI()
  async getBillingPlans(@Request() req?: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req?.clinicContext?.clinicId;
    const role = req?.user?.['role'];
    const userId = req?.user?.['sub'];
    return this.billingService.getBillingPlans(clinicId, role, userId);
  }

  @Get('plans/:id')
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.FINANCE_BILLING,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.RECEPTIONIST,
    Role.NURSE,
    Role.PHARMACIST,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.LAB_TECHNICIAN,
    Role.SUPPORT_STAFF,
    Role.CLINIC_LOCATION_HEAD,
    Role.PATIENT
  )
  @RequireResourcePermission('billing', 'read')
  @Cache({
    keyTemplate: 'billing:plan:{id}',
    ttl: 3600, // 1 hour
    tags: ['billing', 'billing_plans', 'billing_plan:{id}'],
    enableSWR: true,
  })
  @RateLimitAPI()
  async getBillingPlan(@Param('id') id: string) {
    return this.billingService.getBillingPlan(id);
  }

  @Post('plans')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('billing', 'create')
  async createBillingPlan(@Body() createBillingPlanDto: CreateBillingPlanDto) {
    return this.billingService.createBillingPlan(createBillingPlanDto);
  }

  @Put('plans/:id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('billing', 'update')
  async updateBillingPlan(
    @Param('id') id: string,
    @Body() updateBillingPlanDto: UpdateBillingPlanDto
  ) {
    return this.billingService.updateBillingPlan(id, updateBillingPlanDto);
  }

  @Delete('plans/:id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('billing', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBillingPlan(@Param('id') id: string) {
    await this.billingService.deleteBillingPlan(id);
  }

  // ============ Subscriptions ============

  @Post('subscriptions')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.PATIENT, Role.RECEPTIONIST)
  @RequireResourcePermission('subscriptions', 'create')
  async createSubscription(
    @Body() createSubscriptionDto: CreateSubscriptionDto,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    const role = req?.user?.['role'] as Role | undefined;
    const clinicId = req?.clinicContext?.clinicId;

    if (role && role !== Role.PATIENT && clinicId && createSubscriptionDto.clinicId !== clinicId) {
      throw new ForbiddenException('Cannot create subscriptions for a different clinic');
    }

    return this.billingService.createSubscription(
      {
        ...createSubscriptionDto,
        ...(role && role !== Role.PATIENT && clinicId ? { clinicId } : {}),
      },
      this.buildBillingAccessContext(req)
    );
  }

  @Get('subscriptions/user/:userId')
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.FINANCE_BILLING,
    Role.RECEPTIONIST,
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR
  )
  @RequireResourcePermission('subscriptions', 'read', { requireOwnership: true })
  @Cache({
    keyTemplate: 'billing:subscriptions:user:{userId}',
    ttl: 1800, // 30 minutes
    tags: ['billing', 'subscriptions', 'user:{userId}'],
    enableSWR: true,
    containsPHI: true,
  })
  @RateLimitAPI()
  async getUserSubscriptions(
    @Param('userId') userId: string,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    const role = req?.user?.['role'];
    const requestingUserId = req?.user?.['sub'];
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req?.clinicContext?.clinicId;
    return this.billingService.getUserSubscriptions(userId, role, requestingUserId, clinicId);
  }

  @Get('subscriptions/clinic')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING, Role.RECEPTIONIST)
  @RequireResourcePermission('subscriptions', 'read')
  @Cache({
    keyTemplate: 'billing:subscriptions:clinic:{clinicId}',
    ttl: 1800,
    tags: ['billing', 'subscriptions', 'clinic:{clinicId}'],
    enableSWR: true,
    containsPHI: true,
  })
  @RateLimitAPI()
  async getClinicSubscriptions(@Request() req?: ClinicAuthenticatedRequest) {
    const clinicId = req?.clinicContext?.clinicId;
    if (!clinicId) {
      throw new NotFoundException('Clinic context is required');
    }
    return this.billingService.getClinicSubscriptions(clinicId);
  }

  @Get('subscriptions/:id')
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.FINANCE_BILLING,
    Role.RECEPTIONIST,
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR
  )
  @RequireResourcePermission('subscriptions', 'read')
  @Cache({
    keyTemplate: 'billing:subscription:{id}',
    ttl: 1800, // 30 minutes
    tags: ['billing', 'subscriptions', 'subscription:{id}'],
    enableSWR: true,
    containsPHI: true,
  })
  @RateLimitAPI()
  async getSubscription(@Param('id') id: string, @Request() req?: ClinicAuthenticatedRequest) {
    return this.billingService.getSubscription(id, this.buildBillingAccessContext(req));
  }

  @Put('subscriptions/:id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING, Role.RECEPTIONIST)
  @RequireResourcePermission('subscriptions', 'update')
  async updateSubscription(
    @Param('id') id: string,
    @Body() updateSubscriptionDto: UpdateSubscriptionDto,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    return this.billingService.updateSubscription(
      id,
      updateSubscriptionDto,
      this.buildBillingAccessContext(req)
    );
  }

  @Post('subscriptions/:id/cancel')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING, Role.RECEPTIONIST, Role.PATIENT)
  @RequireResourcePermission('subscriptions', 'delete')
  async cancelSubscription(
    @Param('id') id: string,
    @Query('immediate') immediate?: string,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    return this.billingService.cancelSubscription(
      id,
      immediate === 'true',
      this.buildBillingAccessContext(req)
    );
  }

  @Post('subscriptions/:id/renew')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING, Role.RECEPTIONIST, Role.PATIENT)
  @RequireResourcePermission('subscriptions', 'update')
  async renewSubscription(@Param('id') id: string, @Request() req?: ClinicAuthenticatedRequest) {
    return this.billingService.renewSubscription(id, this.buildBillingAccessContext(req));
  }

  // ============ Invoices ============

  @Post('invoices')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.FINANCE_BILLING)
  @RequireResourcePermission('invoices', 'create')
  async createInvoice(@Body() createInvoiceDto: CreateInvoiceDto) {
    return this.billingService.createInvoice(createInvoiceDto);
  }

  @Get('invoices/user/:userId')
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.FINANCE_BILLING,
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.RECEPTIONIST,
    Role.NURSE,
    Role.PHARMACIST,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.LAB_TECHNICIAN,
    Role.SUPPORT_STAFF,
    Role.CLINIC_LOCATION_HEAD
  )
  @RequireResourcePermission('invoices', 'read', { requireOwnership: true })
  @Cache({
    keyTemplate: 'billing:invoices:user:{userId}',
    ttl: 900, // 15 minutes
    tags: ['billing', 'invoices', 'user:{userId}'],
    enableSWR: true,
    containsPHI: true,
  })
  @RateLimitAPI()
  async getUserInvoices(
    @Param('userId') userId: string,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    const role = req?.user?.['role'];
    const requestingUserId = req?.user?.['sub'];
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req?.clinicContext?.clinicId;
    return this.billingService.getUserInvoices(userId, role, requestingUserId, clinicId);
  }

  @Get('invoices/clinic')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING, Role.RECEPTIONIST)
  @RequireResourcePermission('invoices', 'read')
  @Cache({
    keyTemplate: 'billing:invoices:clinic:{clinicId}',
    ttl: 900,
    tags: ['billing', 'invoices', 'clinic:{clinicId}'],
    enableSWR: true,
    containsPHI: true,
  })
  @RateLimitAPI()
  async getClinicInvoices(@Request() req?: ClinicAuthenticatedRequest) {
    const clinicId = req?.clinicContext?.clinicId;
    if (!clinicId) {
      throw new NotFoundException('Clinic context is required');
    }
    return this.billingService.getClinicInvoices(clinicId);
  }

  @Get('invoices/:id')
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.FINANCE_BILLING,
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.RECEPTIONIST,
    Role.NURSE,
    Role.PHARMACIST,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.LAB_TECHNICIAN,
    Role.SUPPORT_STAFF,
    Role.CLINIC_LOCATION_HEAD
  )
  @RequireResourcePermission('invoices', 'read')
  @Cache({
    keyTemplate: 'billing:invoice:{id}',
    ttl: 1800, // 30 minutes
    tags: ['billing', 'invoices', 'invoice:{id}'],
    enableSWR: true,
    containsPHI: true,
  })
  @RateLimitAPI()
  async getInvoice(@Param('id') id: string, @Request() req?: ClinicAuthenticatedRequest) {
    return this.billingService.getInvoice(id, this.buildBillingAccessContext(req));
  }

  @Put('invoices/:id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.FINANCE_BILLING)
  @RequireResourcePermission('invoices', 'update')
  async updateInvoice(
    @Param('id') id: string,
    @Body() updateInvoiceDto: UpdateInvoiceDto,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    return this.billingService.updateInvoice(
      id,
      updateInvoiceDto,
      this.buildBillingAccessContext(req)
    );
  }

  @Post('invoices/:id/mark-paid')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.FINANCE_BILLING)
  @RequireResourcePermission('invoices', 'update')
  async markInvoiceAsPaid(@Param('id') id: string, @Request() req?: ClinicAuthenticatedRequest) {
    return this.billingService.markInvoiceAsPaid(id, this.buildBillingAccessContext(req));
  }

  // ============ Payments ============

  @Post('payments')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.FINANCE_BILLING, Role.PATIENT)
  @RequireResourcePermission('payments', 'create')
  async createPayment(@Body() createPaymentDto: CreatePaymentDto) {
    return this.billingService.createPayment(createPaymentDto);
  }

  @Get('payments/user/:userId')
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.FINANCE_BILLING,
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.RECEPTIONIST,
    Role.NURSE,
    Role.PHARMACIST,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.LAB_TECHNICIAN,
    Role.SUPPORT_STAFF,
    Role.CLINIC_LOCATION_HEAD
  )
  @RequireResourcePermission('payments', 'read', { requireOwnership: true })
  @Cache({
    keyTemplate: 'billing:payments:user:{userId}',
    ttl: 900, // 15 minutes
    tags: ['billing', 'payments', 'user:{userId}'],
    enableSWR: true,
    containsPHI: true,
  })
  @RateLimitAPI()
  async getUserPayments(
    @Param('userId') userId: string,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    const role = req?.user?.['role'];
    const requestingUserId = req?.user?.['sub'];
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req?.clinicContext?.clinicId;
    return this.billingService.getUserPayments(userId, role, requestingUserId, clinicId);
  }

  @Get('payments/clinic')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING, Role.RECEPTIONIST)
  @RequireResourcePermission('payments', 'read')
  @Cache({
    keyTemplate:
      'billing:payments:clinic:{clinicId}:{status}:{revenueModel}:{appointmentType}:{provider}:{startDate}:{endDate}',
    ttl: 300,
    tags: ['billing', 'payments', 'clinic:{clinicId}'],
    enableSWR: true,
  })
  async getClinicPayments(
    @Request() req?: ClinicAuthenticatedRequest,
    @Query('status') status?: string,
    @Query('revenueModel') revenueModel?: string,
    @Query('appointmentType') appointmentType?: string,
    @Query('provider') provider?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    const clinicId = req?.clinicContext?.clinicId;
    if (!clinicId) {
      throw new NotFoundException('Clinic context is required');
    }

    const parsedStartDate = startDate ? new Date(startDate) : undefined;
    const parsedEndDate = endDate ? new Date(endDate) : undefined;
    if (startDate && Number.isNaN(parsedStartDate?.getTime())) {
      throw new BadRequestException('Invalid startDate');
    }
    if (endDate && Number.isNaN(parsedEndDate?.getTime())) {
      throw new BadRequestException('Invalid endDate');
    }

    const paymentProvider = this.parsePaymentProvider(provider);

    return this.billingService.getClinicPayments(clinicId, {
      ...(status ? { status } : {}),
      ...(parsedStartDate ? { startDate: parsedStartDate } : {}),
      ...(parsedEndDate ? { endDate: parsedEndDate } : {}),
      ...(revenueModel
        ? { revenueModel: revenueModel as 'APPOINTMENT' | 'SUBSCRIPTION' | 'OTHER' }
        : {}),
      ...(appointmentType ? { appointmentType } : {}),
      ...(paymentProvider ? { provider: paymentProvider } : {}),
    });
  }

  @Get('payments/ledger')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING)
  @RequireResourcePermission('payments', 'read')
  @Cache({
    keyTemplate:
      'billing:payments:ledger:{clinicId}:{status}:{revenueModel}:{appointmentType}:{provider}:{startDate}:{endDate}',
    ttl: 300,
    tags: ['billing', 'payments', 'ledger', 'clinic:{clinicId}'],
    enableSWR: true,
  })
  async getClinicPaymentLedger(
    @Request() req?: ClinicAuthenticatedRequest,
    @Query('status') status?: string,
    @Query('revenueModel') revenueModel?: string,
    @Query('appointmentType') appointmentType?: string,
    @Query('provider') provider?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    const clinicId = req?.clinicContext?.clinicId;
    if (!clinicId) {
      throw new NotFoundException('Clinic context is required');
    }

    const parsedStartDate = startDate ? new Date(startDate) : undefined;
    const parsedEndDate = endDate ? new Date(endDate) : undefined;
    if (startDate && Number.isNaN(parsedStartDate?.getTime())) {
      throw new BadRequestException('Invalid startDate');
    }
    if (endDate && Number.isNaN(parsedEndDate?.getTime())) {
      throw new BadRequestException('Invalid endDate');
    }

    const paymentProvider = this.parsePaymentProvider(provider);

    return this.billingService.getLedgerEntriesForClinic(clinicId, {
      ...(status ? { status } : {}),
      ...(parsedStartDate ? { startDate: parsedStartDate } : {}),
      ...(parsedEndDate ? { endDate: parsedEndDate } : {}),
      ...(revenueModel
        ? { revenueModel: revenueModel as 'APPOINTMENT' | 'SUBSCRIPTION' | 'OTHER' }
        : {}),
      ...(appointmentType ? { appointmentType } : {}),
      ...(paymentProvider ? { provider: paymentProvider } : {}),
    });
  }

  @Get('payments/:id')
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.FINANCE_BILLING,
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.RECEPTIONIST,
    Role.NURSE,
    Role.PHARMACIST,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.LAB_TECHNICIAN,
    Role.SUPPORT_STAFF,
    Role.CLINIC_LOCATION_HEAD
  )
  @RequireResourcePermission('payments', 'read')
  @Cache({
    keyTemplate: 'billing:payment:{id}',
    ttl: 1800, // 30 minutes
    tags: ['billing', 'payments', 'payment:{id}'],
    enableSWR: true,
    containsPHI: true,
  })
  async getPayment(@Param('id') id: string, @Request() req?: ClinicAuthenticatedRequest) {
    return this.billingService.getPayment(id, this.buildBillingAccessContext(req));
  }

  @Put('payments/:id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.FINANCE_BILLING)
  @RequireResourcePermission('payments', 'update')
  async updatePayment(
    @Param('id') id: string,
    @Body() updatePaymentDto: UpdatePaymentDto,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    return this.billingService.updatePayment(
      id,
      updatePaymentDto,
      this.buildBillingAccessContext(req)
    );
  }

  /**
   * Process refund for a payment
   */
  @Post('payments/:id/refund')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING)
  @RequireResourcePermission('payments', 'update')
  async refundPayment(
    @Param('id') paymentId: string,
    @Body() body: { amount?: number; reason?: string },
    @Query('provider') provider?: string,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req?.clinicContext?.clinicId;
    if (!clinicId) {
      throw new NotFoundException('Clinic context is required for refund');
    }

    const paymentProvider = this.parsePaymentProvider(provider);

    const result = await this.billingService.refundPayment(
      clinicId,
      paymentId,
      body.amount,
      body.reason,
      paymentProvider
    );
    return {
      success: result.success,
      refundId: result.refundId,
      amount: result.amount,
      status: result.status,
      message: result.success
        ? 'Refund processed successfully'
        : `Refund failed: ${result.error || 'Unknown error'}`,
    };
  }

  @Post('payments/:id/reconcile')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING)
  @RequireResourcePermission('payments', 'update')
  async reconcilePayment(
    @Param('id') paymentId: string,
    @Body() body?: { provider?: string },
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    const clinicId = req?.clinicContext?.clinicId;
    if (!clinicId) {
      throw new NotFoundException('Clinic context is required for payment reconciliation');
    }

    const paymentProvider = this.parsePaymentProvider(body?.provider);

    return this.billingService.reconcilePaymentForClinic(clinicId, paymentId, paymentProvider);
  }

  // ============ Analytics ============

  @Get('analytics/revenue')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING)
  @RequireResourcePermission('reports', 'read')
  @Cache({
    keyTemplate: 'billing:analytics:revenue:{clinicId}:{startDate}:{endDate}',
    ttl: 300, // 5 minutes (analytics change frequently)
    tags: ['billing', 'analytics', 'revenue', 'clinic:{clinicId}'],
    enableSWR: true,
  })
  @RateLimitAPI()
  async getClinicRevenue(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req?.clinicContext?.clinicId;
    if (!clinicId) {
      throw new NotFoundException('Clinic context is required for revenue analytics');
    }
    const role = req?.user?.['role'];
    const userId = req?.user?.['sub'];
    return this.billingService.getClinicRevenue(
      clinicId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
      role,
      userId
    );
  }

  @Get('analytics/subscriptions')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('reports', 'read')
  @Cache({
    keyTemplate: 'billing:analytics:subscriptions:{clinicId}',
    ttl: 300, // 5 minutes (analytics change frequently)
    tags: ['billing', 'analytics', 'subscriptions', 'clinic:{clinicId}'],
    enableSWR: true,
  })
  @RateLimitAPI()
  async getSubscriptionMetrics(@Request() req?: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req?.clinicContext?.clinicId;
    if (!clinicId) {
      throw new NotFoundException('Clinic context is required for subscription metrics');
    }
    const role = req?.user?.['role'];
    const userId = req?.user?.['sub'];
    return this.billingService.getSubscriptionMetrics(clinicId, role, userId);
  }

  // ============ Subscription Appointments ============

  /**
   * Check if appointment can be booked with subscription
   * Supports both basic and detailed responses via query parameter
   */
  @Get('subscriptions/:id/coverage')
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.FINANCE_BILLING,
    Role.RECEPTIONIST,
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR
  )
  @RequireResourcePermission('subscriptions', 'read')
  @Cache({
    keyTemplate: 'billing:subscription:coverage:{id}:{appointmentType}',
    ttl: 300, // 5 minutes
    tags: ['billing', 'subscriptions', 'subscription:{id}'],
    enableSWR: true,
  })
  async checkAppointmentCoverage(
    @Param('id') subscriptionId: string,
    @Query('appointmentType') appointmentType?: string,
    @Query('detailed') detailed?: string
  ) {
    // If detailed=true, return detailed coverage info
    if (detailed === 'true') {
      return this.billingService.checkAppointmentCoverage(subscriptionId, appointmentType || '');
    }
    // Otherwise return basic coverage info
    return this.billingService.canBookAppointment(subscriptionId, appointmentType);
  }

  @Post('subscriptions/:subscriptionId/book-appointment/:appointmentId')
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.RECEPTIONIST,
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR
  )
  @RequireResourcePermission('subscriptions', 'create')
  async bookAppointmentWithSubscription(
    @Param('subscriptionId') subscriptionId: string,
    @Param('appointmentId') appointmentId: string,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    const requester = {
      ...(req?.user?.['sub'] ? { userId: req.user['sub'] } : {}),
      ...(req?.user?.['role'] ? { role: req.user['role'] } : {}),
      ...(req?.clinicContext?.clinicId ? { clinicId: req.clinicContext.clinicId } : {}),
    };
    await this.billingService.bookAppointmentWithSubscription(
      subscriptionId,
      appointmentId,
      requester
    );
    return { message: 'Appointment booked with subscription' };
  }

  @Post('subscriptions/:subscriptionId/book-inperson')
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('subscriptions', 'create')
  async bookInPersonAppointmentWithSubscription(
    @Param('subscriptionId') subscriptionId: string,
    @Body() body: CreateInPersonSubscriptionAppointmentDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    const userId = req.user?.['sub'];
    const role = req.user?.['role'] || Role.PATIENT;

    if (!clinicId || !userId) {
      throw new BadRequestException('Clinic context and authenticated user are required');
    }

    if ((body.type || AppointmentType.IN_PERSON) !== AppointmentType.IN_PERSON) {
      throw new BadRequestException('This endpoint only supports IN_PERSON appointments');
    }

    const result = await this.getAppointmentsService().createAppointment(
      {
        ...body,
        type: AppointmentType.IN_PERSON,
      },
      userId,
      clinicId,
      role,
      {
        skipInPersonSubscriptionAutoLink: true,
      }
    );

    if (!result.success || !result.data) {
      // Include both error code and detailed violation message for better UX
      const errorMessage = result.message
        ? `${result.error}: ${result.message}`
        : result.error || 'Failed to create appointment';
      throw new BadRequestException(errorMessage);
    }

    const appointmentId = result.data['id'] as string;
    if (!appointmentId) {
      throw new BadRequestException('Created appointment missing ID');
    }

    try {
      await this.billingService.bookAppointmentWithSubscription(subscriptionId, appointmentId, {
        userId,
        role,
        clinicId,
      });
      return {
        success: true,
        appointment: result.data,
        message: 'In-person appointment booked and linked to subscription',
      };
    } catch (linkError) {
      // Compensating rollback: cancel appointment if subscription link fails
      await this.getAppointmentsService().cancelAppointment(
        appointmentId,
        'Auto-cancelled: failed to link active subscription',
        userId,
        clinicId,
        role
      );
      throw linkError;
    }
  }

  @Post('appointments/:appointmentId/cancel-subscription')
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.RECEPTIONIST,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.PATIENT
  )
  @RequireResourcePermission('subscriptions', 'update')
  async cancelSubscriptionAppointment(@Param('appointmentId') appointmentId: string) {
    await this.billingService.cancelSubscriptionAppointment(appointmentId);
    return { message: 'Subscription appointment cancelled, quota restored' };
  }

  @Get('subscriptions/user/:userId/active')
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.FINANCE_BILLING,
    Role.RECEPTIONIST,
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR
  )
  @RequireResourcePermission('subscriptions', 'read', { requireOwnership: true })
  @Cache({
    keyTemplate: 'billing:subscription:active:user:{userId}:clinic:{clinicId}',
    ttl: 1800, // 30 minutes
    tags: ['billing', 'subscriptions', 'user:{userId}'],
    enableSWR: true,
    containsPHI: true,
  })
  @RateLimitAPI()
  async getActiveUserSubscription(
    @Param('userId') userId: string,
    @Query('clinicId') clinicId: string
  ) {
    return this.billingService.getActiveUserSubscription(userId, clinicId);
  }

  @Get('subscriptions/:id/usage-stats')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING, Role.RECEPTIONIST, Role.PATIENT)
  @RequireResourcePermission('subscriptions', 'read')
  @Cache({
    keyTemplate: 'billing:subscription:usage:{id}',
    ttl: 300, // 5 minutes
    tags: ['billing', 'subscriptions', 'subscription:{id}'],
    enableSWR: true,
    containsPHI: true,
  })
  @RateLimitAPI()
  async getSubscriptionUsageStats(@Param('id') subscriptionId: string) {
    return this.billingService.getSubscriptionUsageStats(subscriptionId);
  }

  @Post('subscriptions/:id/reset-quota')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('subscriptions', 'update')
  async resetSubscriptionQuota(@Param('id') subscriptionId: string) {
    await this.billingService.resetSubscriptionQuota(subscriptionId);
    return { message: 'Subscription quota reset' };
  }

  // ============ Invoice PDF & WhatsApp ============

  @Post('invoices/:id/generate-pdf')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('invoices', 'read')
  async generateInvoicePDF(@Param('id') invoiceId: string) {
    await this.queueService.addJob(
      JobType.INVOICE_PDF,
      'generate_pdf',
      { invoiceId },
      { priority: JobPriorityLevel.NORMAL }
    );
    return { message: 'Invoice PDF generation triggered successfully' };
  }

  @Post('invoices/:id/send-whatsapp')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('invoices', 'read')
  async sendInvoiceViaWhatsApp(@Param('id') invoiceId: string) {
    const success = await this.billingService.sendInvoiceViaWhatsApp(invoiceId);
    return {
      message: success
        ? 'Invoice sent via WhatsApp successfully'
        : 'Failed to send invoice via WhatsApp',
      success,
    };
  }

  @Get('invoices/download/:fileName')
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.FINANCE_BILLING,
    Role.RECEPTIONIST,
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR
  )
  @RequireResourcePermission('invoices', 'read')
  downloadInvoice(@Param('fileName') fileName: string, @Res() res: FastifyReply) {
    // Check if file exists
    if (!this.invoicePDFService.invoicePDFExists(fileName)) {
      throw new NotFoundException('Invoice PDF not found');
    }

    const filePath = this.invoicePDFService.getInvoiceFilePath(fileName);
    const fileStream = fs.createReadStream(filePath);

    res.type('application/pdf');
    res.header('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(fileStream);
  }

  @Post('subscriptions/:id/send-confirmation')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('subscriptions', 'read')
  async sendSubscriptionConfirmation(@Param('id') subscriptionId: string) {
    await this.billingService.sendSubscriptionConfirmation(subscriptionId);
    return { message: 'Subscription confirmation sent successfully' };
  }

  // ============ Payment Processing ============

  /**
   * Process subscription payment (monthly for in-person appointments)
   */
  @Post('subscriptions/:id/process-payment')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING, Role.PATIENT, Role.RECEPTIONIST)
  @RequireResourcePermission('payments', 'create')
  async processSubscriptionPayment(
    @Param('id') subscriptionId: string,
    @Query('provider') provider?: string,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    const paymentProvider = this.parsePaymentProvider(provider);

    const result = await this.billingService.processSubscriptionPayment(
      subscriptionId,
      paymentProvider,
      this.buildBillingAccessContext(req)
    );
    return {
      success: true,
      invoice: result.invoice,
      paymentIntent: result.paymentIntent,
      message: 'Payment intent created successfully. Redirect user to payment gateway.',
    };
  }

  private buildBillingAccessContext(req?: ClinicAuthenticatedRequest) {
    const userId = req?.user?.['sub'] ?? req?.user?.['id'];
    const role = req?.user?.['role'];
    const clinicId = req?.clinicContext?.clinicId;

    return {
      ...(userId ? { userId } : {}),
      ...(role ? { role } : {}),
      ...(clinicId ? { clinicId } : {}),
    };
  }

  /**
   * Process per-appointment payment (for video appointments)
   */
  @Post('appointments/:id/process-payment')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING, Role.PATIENT, Role.RECEPTIONIST)
  @RequireResourcePermission('payments', 'create')
  async processAppointmentPayment(
    @Param('id') appointmentId: string,
    @Body() body: { appointmentType: 'VIDEO_CALL' | 'IN_PERSON' | 'HOME_VISIT' },
    @Query('provider') provider?: string,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    const paymentProvider = this.parsePaymentProvider(provider);

    const result = await this.billingService.processAppointmentPayment(
      appointmentId,
      body.appointmentType,
      paymentProvider,
      this.buildBillingAccessContext(req)
    );
    return {
      success: true,
      invoice: result.invoice,
      paymentIntent: result.paymentIntent,
      message: 'Payment intent created successfully. Redirect user to payment gateway.',
    };
  }

  @Post('invoices/:id/process-payment')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING, Role.PATIENT, Role.RECEPTIONIST)
  @RequireResourcePermission('payments', 'create')
  async processInvoicePayment(
    @Param('id') invoiceId: string,
    @Query('provider') provider?: string,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    const paymentProvider = this.parsePaymentProvider(provider);
    const result = await this.billingService.processInvoicePayment(
      invoiceId,
      paymentProvider,
      this.buildBillingAccessContext(req)
    );
    return {
      success: true,
      invoice: result.invoice,
      paymentIntent: result.paymentIntent,
      message: 'Invoice payment intent created successfully. Redirect user to payment gateway.',
    };
  }

  @Get('appointments/:id/payout-status')
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.FINANCE_BILLING,
    Role.DOCTOR,
    Role.PATIENT,
    Role.RECEPTIONIST
  )
  @RequireResourcePermission('payments', 'read')
  async getAppointmentPayoutStatus(
    @Param('id') appointmentId: string,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    const clinicId = req?.clinicContext?.clinicId;
    if (!clinicId) {
      throw new NotFoundException('Clinic context is required for payout status');
    }
    return this.billingService.getAppointmentPayoutStatus(appointmentId, clinicId);
  }

  @Post('appointments/:id/release-payout')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING)
  @RequireResourcePermission('payments', 'update')
  async releaseAppointmentPayout(
    @Param('id') appointmentId: string,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    const clinicId = req?.clinicContext?.clinicId;
    const initiatedBy = req?.user?.['sub'] || 'system';
    if (!clinicId) {
      throw new NotFoundException('Clinic context is required for payout release');
    }
    return this.billingService.releasePayoutForAppointment(appointmentId, clinicId, initiatedBy);
  }

  // ============ Clinic Expenses ============

  @Post('expenses')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING)
  @RequireResourcePermission('billing', 'create')
  async createExpense(@Body() dto: CreateClinicExpenseDto, @Request() req: AuthenticatedRequest) {
    const userId = req.user?.['sub'] as string;
    return this.billingService.createClinicExpense(dto, userId);
  }

  @Get('expenses')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING)
  @RequireResourcePermission('billing', 'read')
  async getExpenses(@Request() req: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new NotFoundException('Clinic context required');
    return this.billingService.getClinicExpenses(clinicId);
  }

  @Delete('expenses/:id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING)
  @RequireResourcePermission('billing', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteExpense(@Param('id') id: string, @Request() req: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new NotFoundException('Clinic context required');
    await this.billingService.deleteClinicExpense(id, clinicId);
  }

  // ============ Insurance Claims ============

  @Post('insurance-claims')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING)
  @RequireResourcePermission('billing', 'create')
  async createInsuranceClaim(@Body() dto: CreateInsuranceClaimDto) {
    return this.billingService.createInsuranceClaim(dto);
  }

  @Patch('insurance-claims/:id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING)
  @RequireResourcePermission('billing', 'update')
  async updateInsuranceClaim(
    @Param('id') id: string,
    @Body() dto: UpdateInsuranceClaimDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new NotFoundException('Clinic context required');
    return this.billingService.updateInsuranceClaimStatus(id, dto, clinicId);
  }

  @Get('insurance-claims')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING)
  @RequireResourcePermission('billing', 'read')
  async getInsuranceClaims(@Request() req: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new NotFoundException('Clinic context required');
    return this.billingService.getInsuranceClaims(clinicId);
  }

  @Delete('insurance-claims/:id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING)
  @RequireResourcePermission('billing', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteInsuranceClaim(@Param('id') id: string, @Request() req: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new NotFoundException('Clinic context required');
    await this.billingService.deleteInsuranceClaim(id, clinicId);
  }

  @Get('dashboard/financial-stats')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING)
  @RequireResourcePermission('reports', 'read')
  async getFinancialStats(@Request() req: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new NotFoundException('Clinic context required');
    return this.billingService.getStats(clinicId);
  }
}
