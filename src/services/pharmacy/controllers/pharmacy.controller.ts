import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
  Request,
  Res,
  ForbiddenException,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PharmacyService, type PharmacyActor } from '../services/pharmacy.service';
import {
  CreateMedicineDto,
  UpdateInventoryDto,
  CreatePharmacyPrescriptionDto,
  UpdatePharmacyPrescriptionDto,
  UpdatePrescriptionStatusDto,
  DispensePrescriptionDto,
  ReversePrescriptionDispenseDto,
  PharmacyBatchAuditQueryDto,
  PharmacyStatsDto,
  PharmacyStatsQueryDto,
  PharmacySalesQueryDto,
  CreateSupplierDto,
  UpdateSupplierDto,
  RecordCashPaymentDto,
} from '@dtos/pharmacy.dto';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { PatientSelfAccessGuard } from '@core/guards/patient-self-access.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { Cache } from '@core/decorators';
import { RateLimitAPI } from '@security/rate-limit/rate-limit.decorator';
import { Role } from '@core/types/enums.types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';

@ApiTags('pharmacy')
@Controller('pharmacy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
export class PharmacyController {
  constructor(private readonly pharmacyService: PharmacyService) {}

  /** Authenticated caller, used for the audit trail and the dispensed-by stamp. */
  private actorOf(req: ClinicAuthenticatedRequest): PharmacyActor {
    return {
      userId: req.user?.sub ?? req.user?.id,
      role: req.user?.role,
    };
  }

  /**
   * @endpoint GET /pharmacy/inventory
   * @access PHARMACIST, CLINIC_ADMIN, SUPER_ADMIN
   * @frontend pharmacy.server.ts
   * @status ACTIVE
   * @description Get all medicines in pharmacy inventory
   */
  @Get('inventory')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.DOCTOR, Role.ASSISTANT_DOCTOR)
  @RequireResourcePermission('inventory', 'read')
  @Cache({ ttl: 300, tags: ['pharmacy', 'inventory'], priority: 'normal' })
  @RateLimitAPI()
  @ApiOperation({ summary: 'Get all medicines in inventory' })
  async getInventory(
    @Request() req: ClinicAuthenticatedRequest,
    @Query('lowStock') lowStock?: string,
    @Query('expiringSoon') expiringSoon?: string,
    @Query('expiringDays') expiringDays?: string
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.findAllMedicines(clinicId, {
      ...(lowStock === 'true' ? { lowStock: true } : {}),
      ...(expiringSoon === 'true' ? { expiringSoon: true } : {}),
      ...(expiringDays ? { expiringDays: Number(expiringDays) || 90 } : {}),
    });
  }

  /**
   * @endpoint POST /pharmacy/inventory
   * @access PHARMACIST, CLINIC_ADMIN
   * @frontend pharmacy.server.ts
   * @status ACTIVE
   * @description Add new medicine to pharmacy inventory
   */
  @Post('inventory')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN)
  @RequireResourcePermission('inventory', 'create')
  @ApiOperation({ summary: 'Add new medicine to inventory' })
  async addMedicine(@Body() dto: CreateMedicineDto, @Request() req: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.addMedicine(dto, clinicId, this.actorOf(req));
  }

  /**
   * @endpoint PATCH /pharmacy/inventory/:id
   * @access PHARMACIST, CLINIC_ADMIN
   * @frontend NONE
   * @status ADMIN_ONLY
   * @description Edit a medicine (name, type/category, manufacturer, unit, price, batch,
   * expiry, reorder level, supplier, notes, relative stock change, active flag)
   */
  @Patch('inventory/:id')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN)
  @RequireResourcePermission('inventory', 'update')
  @ApiOperation({ summary: 'Edit a medicine of the clinic inventory' })
  async updateInventory(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.updateInventory(id, dto, clinicId, this.actorOf(req));
  }

  /**
   * @endpoint DELETE /pharmacy/inventory/:id
   * @access PHARMACIST, CLINIC_ADMIN
   * @description Soft delete (deactivate). The row is never removed so dispense history keeps
   * resolving it; refused while an open prescription still lists the medicine.
   */
  @Delete('inventory/:id')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN)
  @RequireResourcePermission('inventory', 'delete')
  @ApiOperation({ summary: 'Deactivate (soft delete) a medicine' })
  async deleteInventory(@Param('id') id: string, @Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.deleteMedicine(id, clinicId, this.actorOf(req));
  }

  /**
   * @endpoint GET /pharmacy/inventory/low-stock
   * @access PHARMACIST, CLINIC_ADMIN
   */
  @Get('inventory/low-stock')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN)
  @Cache({ ttl: 600, tags: ['pharmacy', 'low-stock'], priority: 'high' })
  @RateLimitAPI()
  @RequireResourcePermission('inventory', 'read')
  @ApiOperation({ summary: 'Get medicines with low stock levels' })
  async getLowStock(@Request() req: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.findLowStock(clinicId);
  }

  /**
   * @endpoint GET /pharmacy/inventory/expiring-soon
   * @access PHARMACIST, CLINIC_ADMIN
   */
  @Get('inventory/expiring-soon')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN)
  @Cache({ ttl: 600, tags: ['pharmacy', 'expiring-soon'], priority: 'high' })
  @RateLimitAPI()
  @RequireResourcePermission('inventory', 'read')
  @ApiOperation({ summary: 'Get medicines expiring soon' })
  async getExpiringSoon(@Request() req: ClinicAuthenticatedRequest, @Query('days') days?: string) {
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.findExpiringSoon(clinicId, Number(days) || 90);
  }

  /**
   * @endpoint GET /pharmacy/prescriptions
   * @access PHARMACIST
   * @frontend pharmacy.server.ts
   * @status ACTIVE
   * @description Get all prescriptions for pharmacist review
   */
  @Get('prescriptions')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.DOCTOR)
  @RequireResourcePermission('prescriptions', 'read')
  @Cache({ ttl: 300, tags: ['pharmacy', 'prescriptions'], priority: 'normal', containsPHI: true })
  @RateLimitAPI()
  @ApiOperation({ summary: 'Get all prescriptions' })
  async getPrescriptions(@Request() req: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    // DOCTOR: only their own prescriptions. PHARMACIST / CLINIC_ADMIN keep the whole clinic.
    const doctorUserId = req.user?.role === Role.DOCTOR ? req.user.sub : undefined;
    return this.pharmacyService.findAllPrescriptions(
      clinicId,
      doctorUserId ? { doctorUserId } : undefined
    );
  }

  @Get('prescriptions/queue')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.FINANCE_BILLING)
  @RequireResourcePermission('prescriptions', 'read')
  @ApiOperation({ summary: 'Get active medicine desk queue' })
  async getMedicineDeskQueue(@Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.getMedicineDeskQueue(clinicId);
  }

  /**
   * @endpoint POST /pharmacy/prescriptions
   * @access DOCTOR, ASSISTANT_DOCTOR
   * @frontend pharmacy.server.ts
   * @status ACTIVE
   * @description Create new prescription for patient
   */
  @Post('prescriptions')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR)
  @RequireResourcePermission('prescriptions', 'create')
  @ApiOperation({ summary: 'Create a new prescription' })
  async createPrescription(
    @Body() dto: CreatePharmacyPrescriptionDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.createPrescription(dto, clinicId, this.actorOf(req));
  }

  /**
   * @endpoint PATCH /pharmacy/prescriptions/:id
   * @access DOCTOR (the prescribing doctor, same clinic)
   * @description Edit items / notes / diagnosis while the prescription is not yet dispensed
   */
  @Patch('prescriptions/:id')
  @Roles(Role.DOCTOR)
  @RequireResourcePermission('prescriptions', 'update')
  @ApiOperation({ summary: 'Edit a not-yet-dispensed prescription (prescribing doctor only)' })
  async updatePrescription(
    @Param('id') id: string,
    @Body() dto: UpdatePharmacyPrescriptionDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.updatePrescriptionByDoctor(id, dto, clinicId, this.actorOf(req));
  }

  /**
   * @endpoint PATCH /pharmacy/prescriptions/:id/status
   * @access PHARMACIST
   * @description Dispense (FILLED) or cancel a prescription. Enforces immutability.
   */
  @Patch('prescriptions/:id/status')
  @Roles(Role.PHARMACIST)
  @RequireResourcePermission('prescriptions', 'update')
  @ApiOperation({ summary: 'Update prescription status (dispense/cancel)' })
  async updatePrescriptionStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePrescriptionStatusDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.updatePrescriptionStatus(
      id,
      dto.status,
      clinicId,
      dto.notes,
      this.actorOf(req)
    );
  }

  /**
   * @endpoint POST /pharmacy/prescriptions/:id/dispense
   * @access PHARMACIST
   * @description Dispense one or more prescription items, supporting partial completion.
   */
  @Post('prescriptions/:id/dispense')
  @Roles(Role.PHARMACIST)
  @RequireResourcePermission('prescriptions', 'update')
  @ApiOperation({ summary: 'Dispense prescription items (partial or full)' })
  async dispensePrescription(
    @Param('id') id: string,
    @Body() dto: DispensePrescriptionDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.dispensePrescription(id, dto, clinicId, this.actorOf(req));
  }

  /**
   * @endpoint POST /pharmacy/prescriptions/:id/reverse-dispense
   * @access PHARMACIST
   * @description Reverse a dispense correction and restore stock
   */
  @Post('prescriptions/:id/reverse-dispense')
  @Roles(Role.PHARMACIST)
  @RequireResourcePermission('prescriptions', 'update')
  @ApiOperation({ summary: 'Reverse prescription dispense' })
  async reverseDispense(
    @Param('id') id: string,
    @Body() dto: ReversePrescriptionDispenseDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.reversePrescriptionDispense(id, dto, clinicId, this.actorOf(req));
  }

  /**
   * @endpoint GET /pharmacy/audit/batches
   * @access PHARMACIST, CLINIC_ADMIN
   * @description Get pharmacy batch audit entries
   */
  @Get('audit/batches')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN)
  @RequireResourcePermission('prescriptions', 'read')
  @Cache({ ttl: 120, tags: ['pharmacy', 'batch-audit'], priority: 'normal' })
  @RateLimitAPI()
  @ApiOperation({ summary: 'Get pharmacy batch audit entries' })
  async getBatchAudit(
    @Request() req: ClinicAuthenticatedRequest,
    @Query() query: PharmacyBatchAuditQueryDto
  ) {
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.getPharmacyBatchAudit(clinicId, query);
  }

  /**
   * @endpoint GET /pharmacy/prescriptions/:id/pdf
   * @access PATIENT (owner / ACTIVE dependent), DOCTOR (prescribing), PHARMACIST, CLINIC_ADMIN
   * @description Streams the prescription as a PDF (the `pdfUrl` of every prescription payload)
   */
  @Get('prescriptions/:id/pdf')
  @Roles(Role.PATIENT, Role.DOCTOR, Role.PHARMACIST, Role.CLINIC_ADMIN)
  @RequireResourcePermission('prescriptions', 'read', { requireOwnership: true })
  @RateLimitAPI()
  @ApiOperation({ summary: 'Download a prescription as PDF' })
  async getPrescriptionPdf(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest,
    @Res() res: FastifyReply
  ) {
    const { fileName, buffer } = await this.pharmacyService.getPrescriptionPdf(
      id,
      req.clinicContext?.clinicId,
      this.actorOf(req)
    );
    res.type('application/pdf');
    res.header('Content-Disposition', `attachment; filename="${fileName}"`);
    res.header('Cache-Control', 'private, no-store');
    return res.send(buffer);
  }

  @Get('prescriptions/:id/payment-summary')
  @Roles(
    Role.PATIENT,
    Role.PHARMACIST,
    Role.CLINIC_ADMIN,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.RECEPTIONIST
  )
  @RequireResourcePermission('prescriptions', 'read', { requireOwnership: true })
  @ApiOperation({ summary: 'Get prescription payment summary' })
  async getPrescriptionPaymentSummary(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.getPrescriptionPaymentSummary(id, clinicId, {
      ...(req.user?.sub ? { userId: req.user.sub } : {}),
      ...(req.user?.role ? { role: req.user.role } : {}),
    });
  }

  @Post('prescriptions/:id/process-payment')
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.FINANCE_BILLING)
  @RequireResourcePermission('prescriptions', 'update', { requireOwnership: true })
  @ApiOperation({ summary: 'Create payment intent for prescription dispense' })
  async processPrescriptionPayment(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;

    return this.pharmacyService.createPrescriptionPaymentIntent(
      id,
      clinicId,
      {
        ...(req.user?.sub ? { userId: req.user.sub } : {}),
        ...(req.user?.role ? { role: req.user.role } : {}),
      },
      undefined
    );
  }

  /**
   * @endpoint POST /pharmacy/prescriptions/:id/record-cash-payment
   * @access RECEPTIONIST, PHARMACIST, CLINIC_ADMIN, FINANCE_BILLING, SUPER_ADMIN
   * @description Record an over-the-counter cash payment so the medicine desk can dispense
   */
  @Post('prescriptions/:id/record-cash-payment')
  @Roles(
    Role.RECEPTIONIST,
    Role.PHARMACIST,
    Role.CLINIC_ADMIN,
    Role.FINANCE_BILLING,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('payments', 'create')
  @ApiOperation({ summary: 'Record a cash payment for a prescription (no gateway)' })
  async recordCashPrescriptionPayment(
    @Param('id') id: string,
    @Body() body: RecordCashPaymentDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.recordCashPrescriptionPayment(
      id,
      clinicId,
      {
        ...(req.user?.sub ? { userId: req.user.sub } : {}),
        ...(req.user?.role ? { role: req.user.role } : {}),
      },
      body?.amount
    );
  }

  /**
   * @endpoint GET /pharmacy/dashboard/stats
   * @access PHARMACIST, CLINIC_ADMIN
   * @frontend NONE
   * @status ADMIN_ONLY
   * @description Get pharmacy statistics for admin dashboard
   * @note Used by admin panel (not yet implemented in main app)
   */
  @Get('stats')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN)
  @RequireResourcePermission('prescriptions', 'read')
  // The cache key is clinic scoped and carries a digest of the query, so ?period= and the
  // clinic are both part of it (see HealthcareCacheInterceptor.finalizeTemplateKey).
  @Cache({ ttl: 300, tags: ['pharmacy', 'stats'], priority: 'low' })
  @RateLimitAPI()
  @ApiOperation({ summary: 'Get pharmacy statistical summary' })
  async getStats(
    @Request() req: ClinicAuthenticatedRequest,
    @Query() query: PharmacyStatsQueryDto
  ): Promise<PharmacyStatsDto> {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.getStats(clinicId, query.period);
  }

  /**
   * @endpoint GET /pharmacy/sales
   * @access PHARMACIST, CLINIC_ADMIN, SUPER_ADMIN
   * @description Dispensed totals (prescriptions, units, paid revenue) with a per-day or
   *              per-medicine breakdown for from..to
   */
  @Get('sales')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('prescriptions', 'read')
  @Cache({ ttl: 300, tags: ['pharmacy', 'sales'], priority: 'low' })
  @RateLimitAPI()
  @ApiOperation({ summary: 'Pharmacy sales report (dispensed totals and breakdown)' })
  async getSales(
    @Request() req: ClinicAuthenticatedRequest,
    @Query() query: PharmacySalesQueryDto
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required');
    return this.pharmacyService.getSalesReport(clinicId, query);
  }

  // ============ Supplier Management ============

  @Get('suppliers')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('inventory', 'read')
  @Cache({ ttl: 3600, tags: ['pharmacy', 'suppliers'], priority: 'low' })
  @RateLimitAPI()
  @ApiOperation({ summary: 'Get all medicine suppliers' })
  async getSuppliers(@Request() req: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.findAllSuppliers(clinicId);
  }

  @Post('suppliers')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('inventory', 'create')
  @ApiOperation({ summary: 'Add a new supplier' })
  async addSupplier(@Body() dto: CreateSupplierDto, @Request() req: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required');
    return this.pharmacyService.addSupplier(dto, clinicId);
  }

  @Patch('suppliers/:id')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('inventory', 'update')
  @ApiOperation({ summary: 'Update supplier details' })
  async updateSupplier(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required');
    return this.pharmacyService.updateSupplier(id, dto, clinicId);
  }

  /**
   * @endpoint GET /pharmacy/prescriptions/patient/:userId
   * @access PATIENT, DOCTOR, CLINIC_ADMIN, SUPER_ADMIN
   * @frontend medical-records.server.ts
   * @status ACTIVE (NEW - Added 2026-01-23)
   * @description Get prescriptions for specific patient
   * @ownership Patients can only view their own prescriptions and those of an ACTIVE
   * dependent (PatientSelfAccessGuard, which also runs before the response cache)
   * @tenancy Staff (PHARMACIST, CLINIC_ADMIN, DOCTOR) only get the prescriptions of the
   * request clinic; a patient sees their own prescriptions of every clinic
   * @note Fixed dashboard redirect loop issue
   */
  @Get('prescriptions/patient/:userId')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.DOCTOR, Role.PATIENT)
  @UseGuards(PatientSelfAccessGuard)
  @RequireResourcePermission('prescriptions', 'read', { requireOwnership: true })
  @Cache({
    ttl: 300,
    tags: ['pharmacy', 'patient-prescriptions'],
    priority: 'normal',
    containsPHI: true,
  })
  @RateLimitAPI()
  @ApiOperation({ summary: 'Get prescriptions for a specific patient' })
  async getPatientPrescriptions(
    @Param('userId') userId: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // PATIENT callers are limited to their own / an ACTIVE dependent's id by
    // PatientSelfAccessGuard (403 otherwise) and see that patient's prescriptions of
    // every clinic. Staff are scoped to the validated clinic of the request, so they
    // never see another clinic's prescriptions of a shared patient.
    return this.pharmacyService.findPrescriptionsByPatient(userId, {
      ...(req.user?.role ? { role: req.user.role } : {}),
      ...(req.clinicContext?.clinicId ? { clinicId: req.clinicContext.clinicId } : {}),
    });
  }

  /**
   * @endpoint GET /pharmacy/prescriptions/:id
   * @access PATIENT (own + ACTIVE dependents), PHARMACIST, CLINIC_ADMIN, DOCTOR, ASSISTANT_DOCTOR, RECEPTIONIST
   * @description Single prescription, same shape as the list endpoints.
   * Declared last so the static `prescriptions/queue` route keeps precedence.
   */
  @Get('prescriptions/:id')
  @Roles(
    Role.PATIENT,
    Role.PHARMACIST,
    Role.CLINIC_ADMIN,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.RECEPTIONIST
  )
  @RequireResourcePermission('prescriptions', 'read', { requireOwnership: true })
  @ApiOperation({ summary: 'Get a single prescription' })
  async getPrescriptionById(@Param('id') id: string, @Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.findPrescriptionById(id, clinicId, {
      ...(req.user?.sub ? { userId: req.user.sub } : {}),
      ...(req.user?.role ? { role: req.user.role } : {}),
    });
  }
}
