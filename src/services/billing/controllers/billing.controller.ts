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
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import * as fs from 'fs';
import { BillingService } from '../billing.service';
import { InvoicePDFService } from '../invoice-pdf.service';
import {
  CreateBillingPlanDto,
  UpdateBillingPlanDto,
  CreateSubscriptionDto,
  UpdateSubscriptionDto,
  CreatePaymentDto,
  UpdatePaymentDto,
  CreateInvoiceDto,
  UpdateInvoiceDto,
} from '../dto/billing.dto';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';

@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly invoicePDFService: InvoicePDFService
  ) {}

  // ============ Billing Plans ============

  @Get('plans')
  async getBillingPlans(@Query('clinicId') clinicId?: string) {
    return this.billingService.getBillingPlans(clinicId);
  }

  @Get('plans/:id')
  async getBillingPlan(@Param('id') id: string) {
    return this.billingService.getBillingPlan(id);
  }

  @Post('plans')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  async createBillingPlan(@Body() createBillingPlanDto: CreateBillingPlanDto) {
    return this.billingService.createBillingPlan(createBillingPlanDto);
  }

  @Put('plans/:id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  async updateBillingPlan(
    @Param('id') id: string,
    @Body() updateBillingPlanDto: UpdateBillingPlanDto
  ) {
    return this.billingService.updateBillingPlan(id, updateBillingPlanDto);
  }

  @Delete('plans/:id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBillingPlan(@Param('id') id: string) {
    await this.billingService.deleteBillingPlan(id);
  }

  // ============ Subscriptions ============

  @Post('subscriptions')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.PATIENT)
  async createSubscription(@Body() createSubscriptionDto: CreateSubscriptionDto) {
    return this.billingService.createSubscription(createSubscriptionDto);
  }

  @Get('subscriptions/user/:userId')
  async getUserSubscriptions(@Param('userId') userId: string) {
    return this.billingService.getUserSubscriptions(userId);
  }

  @Get('subscriptions/:id')
  async getSubscription(@Param('id') id: string) {
    return this.billingService.getSubscription(id);
  }

  @Put('subscriptions/:id')
  async updateSubscription(
    @Param('id') id: string,
    @Body() updateSubscriptionDto: UpdateSubscriptionDto
  ) {
    return this.billingService.updateSubscription(id, updateSubscriptionDto);
  }

  @Post('subscriptions/:id/cancel')
  async cancelSubscription(@Param('id') id: string, @Query('immediate') immediate?: string) {
    return this.billingService.cancelSubscription(id, immediate === 'true');
  }

  @Post('subscriptions/:id/renew')
  async renewSubscription(@Param('id') id: string) {
    return this.billingService.renewSubscription(id);
  }

  // ============ Invoices ============

  @Post('invoices')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST)
  async createInvoice(@Body() createInvoiceDto: CreateInvoiceDto) {
    return this.billingService.createInvoice(createInvoiceDto);
  }

  @Get('invoices/user/:userId')
  async getUserInvoices(@Param('userId') userId: string) {
    return this.billingService.getUserInvoices(userId);
  }

  @Get('invoices/:id')
  async getInvoice(@Param('id') id: string) {
    return this.billingService.getInvoice(id);
  }

  @Put('invoices/:id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST)
  async updateInvoice(@Param('id') id: string, @Body() updateInvoiceDto: UpdateInvoiceDto) {
    return this.billingService.updateInvoice(id, updateInvoiceDto);
  }

  @Post('invoices/:id/mark-paid')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST)
  async markInvoiceAsPaid(@Param('id') id: string) {
    return this.billingService.markInvoiceAsPaid(id);
  }

  // ============ Payments ============

  @Post('payments')
  async createPayment(@Body() createPaymentDto: CreatePaymentDto) {
    return this.billingService.createPayment(createPaymentDto);
  }

  @Get('payments/user/:userId')
  async getUserPayments(@Param('userId') userId: string) {
    return this.billingService.getUserPayments(userId);
  }

  @Get('payments/:id')
  async getPayment(@Param('id') id: string) {
    return this.billingService.getPayment(id);
  }

  @Put('payments/:id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST)
  async updatePayment(@Param('id') id: string, @Body() updatePaymentDto: UpdatePaymentDto) {
    return this.billingService.updatePayment(id, updatePaymentDto);
  }

  // ============ Analytics ============

  @Get('analytics/revenue')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  async getClinicRevenue(
    @Query('clinicId') clinicId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    return this.billingService.getClinicRevenue(
      clinicId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined
    );
  }

  @Get('analytics/subscriptions')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  async getSubscriptionMetrics(@Query('clinicId') clinicId: string) {
    return this.billingService.getSubscriptionMetrics(clinicId);
  }

  // ============ Subscription Appointments ============

  @Get('subscriptions/:id/can-book-appointment')
  async canBookAppointment(
    @Param('id') subscriptionId: string,
    @Query('appointmentType') appointmentType?: string
  ) {
    return this.billingService.canBookAppointment(subscriptionId, appointmentType);
  }

  @Post('subscriptions/:id/check-coverage')
  async checkAppointmentCoverage(
    @Param('id') subscriptionId: string,
    @Body() body: { appointmentType: string }
  ) {
    return this.billingService.checkAppointmentCoverage(subscriptionId, body.appointmentType);
  }

  @Post('subscriptions/:subscriptionId/book-appointment/:appointmentId')
  async bookAppointmentWithSubscription(
    @Param('subscriptionId') subscriptionId: string,
    @Param('appointmentId') appointmentId: string
  ) {
    await this.billingService.bookAppointmentWithSubscription(subscriptionId, appointmentId);
    return { message: 'Appointment booked with subscription' };
  }

  @Post('appointments/:appointmentId/cancel-subscription')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.DOCTOR, Role.PATIENT)
  async cancelSubscriptionAppointment(@Param('appointmentId') appointmentId: string) {
    await this.billingService.cancelSubscriptionAppointment(appointmentId);
    return { message: 'Subscription appointment cancelled, quota restored' };
  }

  @Get('subscriptions/user/:userId/active')
  async getActiveUserSubscription(
    @Param('userId') userId: string,
    @Query('clinicId') clinicId: string
  ) {
    return this.billingService.getActiveUserSubscription(userId, clinicId);
  }

  @Get('subscriptions/:id/usage-stats')
  async getSubscriptionUsageStats(@Param('id') subscriptionId: string) {
    return this.billingService.getSubscriptionUsageStats(subscriptionId);
  }

  @Post('subscriptions/:id/reset-quota')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  async resetSubscriptionQuota(@Param('id') subscriptionId: string) {
    await this.billingService.resetSubscriptionQuota(subscriptionId);
    return { message: 'Subscription quota reset' };
  }

  // ============ Invoice PDF & WhatsApp ============

  @Post('invoices/:id/generate-pdf')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  async generateInvoicePDF(@Param('id') invoiceId: string) {
    await this.billingService.generateInvoicePDF(invoiceId);
    return { message: 'Invoice PDF generated successfully' };
  }

  @Post('invoices/:id/send-whatsapp')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
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
  async sendSubscriptionConfirmation(@Param('id') subscriptionId: string) {
    await this.billingService.sendSubscriptionConfirmation(subscriptionId);
    return { message: 'Subscription confirmation sent successfully' };
  }
}
