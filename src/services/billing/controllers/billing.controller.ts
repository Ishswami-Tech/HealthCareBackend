import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
  NotFoundException,
  Request,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import * as fs from 'fs';
import { BillingService } from '@services/billing/billing.service';
import { InvoicePDFService } from '@services/billing/invoice-pdf.service';
import {
  CreateBillingPlanDto,
  UpdateBillingPlanDto,
  CreateSubscriptionDto,
  UpdateSubscriptionDto,
  CreatePaymentDto,
  UpdatePaymentDto,
  CreateInvoiceDto,
  UpdateInvoiceDto,
} from '@dtos/billing.dto';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { Cache } from '@core/decorators';
import { Role } from '@core/types/enums.types';
import type { AuthenticatedRequest } from '@core/types';
import { PaymentProvider } from '@core/types';

@ApiTags('billing')
@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard, RbacGuard)
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly invoicePDFService: InvoicePDFService
  ) {}

  // ============ Billing Plans ============

  @Get('plans')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING, Role.DOCTOR, Role.PATIENT)
  @RequireResourcePermission('billing', 'read')
  @Cache({
    keyTemplate: 'billing:plans:{clinicId}',
    ttl: 3600, // 1 hour
    tags: ['billing', 'billing_plans'],
    enableSWR: true,
  })
  async getBillingPlans(
    @Query('clinicId') clinicId?: string,
    @Request() req?: AuthenticatedRequest
  ) {
    const role = req?.user?.['role'];
    const userId = req?.user?.['sub'] as string | undefined;
    return this.billingService.getBillingPlans(clinicId, role, userId);
  }

  @Get('plans/:id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING, Role.DOCTOR)
  @RequireResourcePermission('billing', 'read')
  @Cache({
    keyTemplate: 'billing:plan:{id}',
    ttl: 3600, // 1 hour
    tags: ['billing', 'billing_plans', 'billing_plan:{id}'],
    enableSWR: true,
  })
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
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.PATIENT)
  @RequireResourcePermission('subscriptions', 'create')
  async createSubscription(@Body() createSubscriptionDto: CreateSubscriptionDto) {
    return this.billingService.createSubscription(createSubscriptionDto);
  }

  @Get('subscriptions/user/:userId')
  @RequireResourcePermission('subscriptions', 'read', { requireOwnership: true })
  @Cache({
    keyTemplate: 'billing:subscriptions:user:{userId}',
    ttl: 1800, // 30 minutes
    tags: ['billing', 'subscriptions', 'user:{userId}'],
    enableSWR: true,
  })
  async getUserSubscriptions(
    @Param('userId') userId: string,
    @Request() req?: AuthenticatedRequest
  ) {
    const role = req?.user?.['role'];
    const requestingUserId = req?.user?.['sub'] as string | undefined;
    return this.billingService.getUserSubscriptions(userId, role, requestingUserId);
  }

  @Get('subscriptions/:id')
  @RequireResourcePermission('subscriptions', 'read')
  @Cache({
    keyTemplate: 'billing:subscription:{id}',
    ttl: 1800, // 30 minutes
    tags: ['billing', 'subscriptions', 'subscription:{id}'],
    enableSWR: true,
  })
  async getSubscription(@Param('id') id: string) {
    return this.billingService.getSubscription(id);
  }

  @Put('subscriptions/:id')
  @RequireResourcePermission('subscriptions', 'update')
  async updateSubscription(
    @Param('id') id: string,
    @Body() updateSubscriptionDto: UpdateSubscriptionDto
  ) {
    return this.billingService.updateSubscription(id, updateSubscriptionDto);
  }

  @Post('subscriptions/:id/cancel')
  @RequireResourcePermission('subscriptions', 'delete')
  async cancelSubscription(@Param('id') id: string, @Query('immediate') immediate?: string) {
    return this.billingService.cancelSubscription(id, immediate === 'true');
  }

  @Post('subscriptions/:id/renew')
  @RequireResourcePermission('subscriptions', 'update')
  async renewSubscription(@Param('id') id: string) {
    return this.billingService.renewSubscription(id);
  }

  // ============ Invoices ============

  @Post('invoices')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.FINANCE_BILLING)
  @RequireResourcePermission('invoices', 'create')
  async createInvoice(@Body() createInvoiceDto: CreateInvoiceDto) {
    return this.billingService.createInvoice(createInvoiceDto);
  }

  @Get('invoices/user/:userId')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING, Role.PATIENT, Role.DOCTOR)
  @RequireResourcePermission('invoices', 'read', { requireOwnership: true })
  @Cache({
    keyTemplate: 'billing:invoices:user:{userId}',
    ttl: 900, // 15 minutes
    tags: ['billing', 'invoices', 'user:{userId}'],
    enableSWR: true,
  })
  async getUserInvoices(@Param('userId') userId: string, @Request() req?: AuthenticatedRequest) {
    const role = req?.user?.['role'];
    const requestingUserId = req?.user?.['sub'] as string | undefined;
    return this.billingService.getUserInvoices(userId, role, requestingUserId);
  }

  @Get('invoices/:id')
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.FINANCE_BILLING,
    Role.PATIENT,
    Role.DOCTOR,
    Role.RECEPTIONIST
  )
  @RequireResourcePermission('invoices', 'read')
  @Cache({
    keyTemplate: 'billing:invoice:{id}',
    ttl: 1800, // 30 minutes
    tags: ['billing', 'invoices', 'invoice:{id}'],
    enableSWR: true,
  })
  async getInvoice(@Param('id') id: string) {
    return this.billingService.getInvoice(id);
  }

  @Put('invoices/:id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.FINANCE_BILLING)
  @RequireResourcePermission('invoices', 'update')
  async updateInvoice(@Param('id') id: string, @Body() updateInvoiceDto: UpdateInvoiceDto) {
    return this.billingService.updateInvoice(id, updateInvoiceDto);
  }

  @Post('invoices/:id/mark-paid')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.FINANCE_BILLING)
  @RequireResourcePermission('invoices', 'update')
  async markInvoiceAsPaid(@Param('id') id: string) {
    return this.billingService.markInvoiceAsPaid(id);
  }

  // ============ Payments ============

  @Post('payments')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.FINANCE_BILLING, Role.PATIENT)
  @RequireResourcePermission('payments', 'create')
  async createPayment(@Body() createPaymentDto: CreatePaymentDto) {
    return this.billingService.createPayment(createPaymentDto);
  }

  @Get('payments/user/:userId')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING, Role.PATIENT, Role.DOCTOR)
  @RequireResourcePermission('payments', 'read', { requireOwnership: true })
  @Cache({
    keyTemplate: 'billing:payments:user:{userId}',
    ttl: 900, // 15 minutes
    tags: ['billing', 'payments', 'user:{userId}'],
    enableSWR: true,
  })
  async getUserPayments(@Param('userId') userId: string, @Request() req?: AuthenticatedRequest) {
    const role = req?.user?.['role'];
    const requestingUserId = req?.user?.['sub'] as string | undefined;
    return this.billingService.getUserPayments(userId, role, requestingUserId);
  }

  @Get('payments/:id')
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.FINANCE_BILLING,
    Role.PATIENT,
    Role.DOCTOR,
    Role.RECEPTIONIST
  )
  @RequireResourcePermission('payments', 'read')
  @Cache({
    keyTemplate: 'billing:payment:{id}',
    ttl: 1800, // 30 minutes
    tags: ['billing', 'payments', 'payment:{id}'],
    enableSWR: true,
  })
  async getPayment(@Param('id') id: string) {
    return this.billingService.getPayment(id);
  }

  @Put('payments/:id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.FINANCE_BILLING)
  @RequireResourcePermission('payments', 'update')
  async updatePayment(@Param('id') id: string, @Body() updatePaymentDto: UpdatePaymentDto) {
    return this.billingService.updatePayment(id, updatePaymentDto);
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
    @Query('clinicId') clinicId: string,
    @Query('provider') provider?: string
  ) {
    // Convert provider string to PaymentProvider enum
    let paymentProvider: PaymentProvider | undefined;
    if (provider) {
      const normalizedProvider = provider.toLowerCase();
      if (normalizedProvider === 'razorpay') {
        paymentProvider = PaymentProvider.RAZORPAY;
      } else if (normalizedProvider === 'phonepe') {
        paymentProvider = PaymentProvider.PHONEPE;
      }
    }

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
  async getClinicRevenue(
    @Query('clinicId') clinicId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Request() req?: AuthenticatedRequest
  ) {
    const role = req?.user?.['role'];
    const userId = req?.user?.['sub'] as string | undefined;
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
  async getSubscriptionMetrics(
    @Query('clinicId') clinicId: string,
    @Request() req?: AuthenticatedRequest
  ) {
    const role = req?.user?.['role'];
    const userId = req?.user?.['sub'] as string | undefined;
    return this.billingService.getSubscriptionMetrics(clinicId, role, userId);
  }

  // ============ Subscription Appointments ============

  /**
   * Check if appointment can be booked with subscription
   * Supports both basic and detailed responses via query parameter
   */
  @Get('subscriptions/:id/coverage')
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
  @RequireResourcePermission('subscriptions', 'update')
  async bookAppointmentWithSubscription(
    @Param('subscriptionId') subscriptionId: string,
    @Param('appointmentId') appointmentId: string
  ) {
    await this.billingService.bookAppointmentWithSubscription(subscriptionId, appointmentId);
    return { message: 'Appointment booked with subscription' };
  }

  @Post('appointments/:appointmentId/cancel-subscription')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.DOCTOR, Role.PATIENT)
  @RequireResourcePermission('subscriptions', 'update')
  async cancelSubscriptionAppointment(@Param('appointmentId') appointmentId: string) {
    await this.billingService.cancelSubscriptionAppointment(appointmentId);
    return { message: 'Subscription appointment cancelled, quota restored' };
  }

  @Get('subscriptions/user/:userId/active')
  @RequireResourcePermission('subscriptions', 'read', { requireOwnership: true })
  @Cache({
    keyTemplate: 'billing:subscription:active:user:{userId}:clinic:{clinicId}',
    ttl: 1800, // 30 minutes
    tags: ['billing', 'subscriptions', 'user:{userId}'],
    enableSWR: true,
  })
  async getActiveUserSubscription(
    @Param('userId') userId: string,
    @Query('clinicId') clinicId: string
  ) {
    return this.billingService.getActiveUserSubscription(userId, clinicId);
  }

  @Get('subscriptions/:id/usage-stats')
  @RequireResourcePermission('subscriptions', 'read')
  @Cache({
    keyTemplate: 'billing:subscription:usage:{id}',
    ttl: 300, // 5 minutes
    tags: ['billing', 'subscriptions', 'subscription:{id}'],
    enableSWR: true,
  })
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
    await this.billingService.generateInvoicePDF(invoiceId);
    return { message: 'Invoice PDF generated successfully' };
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
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.FINANCE_BILLING, Role.PATIENT)
  @RequireResourcePermission('payments', 'create')
  async processSubscriptionPayment(
    @Param('id') subscriptionId: string,
    @Query('provider') provider?: string
  ) {
    // Convert provider string to PaymentProvider enum
    let paymentProvider: PaymentProvider | undefined;
    if (provider) {
      const normalizedProvider = provider.toLowerCase();
      if (normalizedProvider === 'razorpay') {
        paymentProvider = PaymentProvider.RAZORPAY;
      } else if (normalizedProvider === 'phonepe') {
        paymentProvider = PaymentProvider.PHONEPE;
      }
    }

    const result = await this.billingService.processSubscriptionPayment(
      subscriptionId,
      paymentProvider
    );
    return {
      success: true,
      invoice: result.invoice,
      paymentIntent: result.paymentIntent,
      message: 'Payment intent created successfully. Redirect user to payment gateway.',
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
    @Body() body: { amount: number; appointmentType: 'VIDEO_CALL' | 'IN_PERSON' | 'HOME_VISIT' },
    @Query('provider') provider?: string
  ) {
    // Convert provider string to PaymentProvider enum
    let paymentProvider: PaymentProvider | undefined;
    if (provider) {
      const normalizedProvider = provider.toLowerCase();
      if (normalizedProvider === 'razorpay') {
        paymentProvider = PaymentProvider.RAZORPAY;
      } else if (normalizedProvider === 'phonepe') {
        paymentProvider = PaymentProvider.PHONEPE;
      }
    }

    const result = await this.billingService.processAppointmentPayment(
      appointmentId,
      body.amount,
      body.appointmentType,
      paymentProvider
    );
    return {
      success: true,
      invoice: result.invoice,
      paymentIntent: result.paymentIntent,
      message: 'Payment intent created successfully. Redirect user to payment gateway.',
    };
  }
}
