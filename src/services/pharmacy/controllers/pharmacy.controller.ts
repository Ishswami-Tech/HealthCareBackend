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
  ValidationPipe,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { ValidationPipeConfig } from '@config/validation-pipe.config';
import { legacyPrescriptionListHeaders } from '@services/pharmacy/services/prescription-legacy-list.util';
import {
  PharmacyService,
  type InventoryPage,
  type PharmacyActor,
} from '../services/pharmacy.service';
import {
  CreateMedicineDto,
  INVENTORY_DEFAULT_PAGE_SIZE,
  InventoryQueryDto,
  LOW_STOCK_DEFAULT_LIMIT,
  LowStockQueryDto,
  toInventoryFilters,
  UpdateInventoryDto,
  CreatePharmacyPrescriptionDto,
  UpdatePharmacyPrescriptionDto,
  UpdatePrescriptionStatusDto,
  DispensePrescriptionDto,
  ReversePrescriptionDispenseDto,
  PharmacyBatchAuditQueryDto,
  PharmacyStatsDto,
  InventorySummaryDto,
  PharmacyStatsQueryDto,
  PharmacySalesQueryDto,
  CreateSupplierDto,
  UpdateSupplierDto,
  RecordCashPaymentDto,
  ListPrescriptionsQueryDto,
  PrescriptionSummaryQueryDto,
  PrescriptionSummaryDto,
  PrescriptionListSort,
  PrescriptionPharmacyStage,
  PRESCRIPTION_LIST_DEFAULT_PAGE_SIZE,
  PRESCRIPTION_LIST_PAGE_SIZES,
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
import type { Medicine } from '@core/types/database.types';

/**
 * Validates the query of the paged prescription list. The legacy (no `page`) call is not
 * validated at all, exactly as before, so old apps sending ignored keys (`search`, ...) keep working.
 */
const PRESCRIPTION_LIST_QUERY_PIPE = new ValidationPipe(ValidationPipeConfig.getOptions());

@ApiTags('pharmacy')
@ApiExtraModels(PrescriptionSummaryDto)
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
   * @access PHARMACIST, CLINIC_ADMIN, SUPER_ADMIN, DOCTOR, ASSISTANT_DOCTOR
   * @frontend pharmacy.server.ts
   * @status ACTIVE
   * @description Medicines of the clinic inventory, filtered in the database (`search`,
   * `category`, `type`, `inStock`, `lowStock`, `outOfStock`, `expiringSoon`/`expiringDays`) and ordered by
   * name. Without `page` the legacy bare array of every matching row is returned (`limit` is
   * ignored, so older clients sending `limit` alone still get everything); with `page` the
   * response is `{ data, total, page, limit }`. `X-Total-Count` carries the matching total on
   * every response built by this handler; the cache (default key, which includes the full query)
   * replays the body only.
   */
  @Get('inventory')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.DOCTOR, Role.ASSISTANT_DOCTOR)
  @RequireResourcePermission('inventory', 'read')
  @Cache({ ttl: 300, tags: ['pharmacy', 'inventory'], priority: 'normal' })
  @RateLimitAPI()
  @ApiOperation({ summary: 'List (filter, optionally paginate) the medicines in inventory' })
  async getInventory(
    @Request() req: ClinicAuthenticatedRequest,
    @Query() query: InventoryQueryDto,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<Medicine[] | InventoryPage> {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    const filters = toInventoryFilters(query);
    if (query.page === undefined) {
      const medicines = await this.pharmacyService.findAllMedicines(clinicId, filters);
      reply.header('X-Total-Count', String(medicines.length));
      return medicines;
    }
    const result = await this.pharmacyService.findInventoryPage(
      clinicId,
      filters,
      query.page,
      query.limit ?? INVENTORY_DEFAULT_PAGE_SIZE
    );
    reply.header('X-Total-Count', String(result.total));
    return result;
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
   * @endpoint GET /pharmacy/inventory/summary
   * @access PHARMACIST, CLINIC_ADMIN, SUPER_ADMIN, DOCTOR, ASSISTANT_DOCTOR
   * @frontend pharmacy.server.ts (getInventoryCounts)
   * @status ACTIVE
   * @description Whole-inventory stock tiles of the clinic in one read: total, in stock,
   * low (0 < stock <= reorder level), out (stock <= 0), expiring soon and stock value. Not cached
   * so the tiles agree with the list right after a dispense or restock.
   */
  @Get('inventory/summary')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.DOCTOR, Role.ASSISTANT_DOCTOR)
  @RequireResourcePermission('inventory', 'read')
  @RateLimitAPI()
  @ApiOperation({ summary: 'Whole-inventory stock counts (low / out separately) and value' })
  @ApiOkResponse({ type: InventorySummaryDto })
  async getInventorySummary(
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<InventorySummaryDto> {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.getInventorySummary(clinicId);
  }

  /**
   * @endpoint GET /pharmacy/inventory/low-stock
   * @access PHARMACIST, CLINIC_ADMIN
   * @description Active medicines at or below their reorder level, lowest stock first, capped
   * at `limit` (default 100, max 500). One database query (stock <= minStockThreshold).
   */
  @Get('inventory/low-stock')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN)
  @Cache({ ttl: 600, tags: ['pharmacy', 'low-stock'], priority: 'high' })
  @RateLimitAPI()
  @RequireResourcePermission('inventory', 'read')
  @ApiOperation({ summary: 'Get medicines with low stock levels' })
  async getLowStock(
    @Request() req: ClinicAuthenticatedRequest,
    @Query() query: LowStockQueryDto
  ): Promise<Medicine[]> {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.findLowStock(clinicId, query.limit ?? LOW_STOCK_DEFAULT_LIMIT);
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
   * @access PHARMACIST, CLINIC_ADMIN, DOCTOR (own prescriptions only)
   * @frontend prescriptions.server.ts, pharmacy.server.ts
   * @status ACTIVE
   * @description Without `page`: the legacy bare array of the most recent 200 prescriptions
   * (drafts excluded), newest first, query ignored; `X-Total-Count` / `X-Truncated` headers. With `page`: `{ data, total, page, limit }`, filtered / searched / sorted in
   * the database (`q`, `status`, `pharmacyStage`, `dateFrom` / `dateTo` IST days, `patientId`,
   * `sort`), rows in the legacy row shape. Cached per caller + full query (tags pharmacy,
   * prescriptions); every prescription write / dispense / payment / draft transition busts it.
   */
  @Get('prescriptions')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.DOCTOR)
  @RequireResourcePermission('prescriptions', 'read')
  @Cache({ ttl: 300, tags: ['pharmacy', 'prescriptions'], priority: 'normal', containsPHI: true })
  @RateLimitAPI()
  @ApiOperation({
    summary: 'List prescriptions (legacy array, or a filtered page when `page` is given)',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: '1-based; enables paging' })
  @ApiQuery({
    name: 'limit',
    required: false,
    enum: PRESCRIPTION_LIST_PAGE_SIZES,
    description: `Page size (default ${PRESCRIPTION_LIST_DEFAULT_PAGE_SIZE})`,
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description:
      'Search: patient name / phone, UHID, OPD number, prescription number, medicine, diagnosis',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['ACTIVE', 'COMPLETED', 'CANCELLED', 'DRAFT', 'RETURNED', 'PENDING', 'PARTIAL', 'FILLED'],
  })
  @ApiQuery({ name: 'pharmacyStage', required: false, enum: PrescriptionPharmacyStage })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'IST day YYYY-MM-DD (inclusive)' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'IST day YYYY-MM-DD (inclusive)' })
  @ApiQuery({ name: 'patientId', required: false, description: 'Patient.id (uuid)' })
  @ApiQuery({ name: 'sort', required: false, enum: PrescriptionListSort })
  @ApiOkResponse({
    description:
      'Legacy: Prescription[]. With `page`: { data: Prescription[], total, page, limit } (same row shape)',
    schema: {
      oneOf: [
        { type: 'array', items: { type: 'object' } },
        {
          type: 'object',
          properties: {
            data: { type: 'array', items: { type: 'object' } },
            total: { type: 'number' },
            page: { type: 'number' },
            limit: { type: 'number' },
          },
        },
      ],
    },
  })
  async getPrescriptions(
    @Request() req: ClinicAuthenticatedRequest,
    @Query() rawQuery: Record<string, string | string[] | undefined>,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    if (rawQuery?.['page'] !== undefined) {
      const query = (await PRESCRIPTION_LIST_QUERY_PIPE.transform(rawQuery, {
        type: 'query',
        metatype: ListPrescriptionsQueryDto,
      })) as ListPrescriptionsQueryDto;
      return this.pharmacyService.findPrescriptionsPage(
        clinicId,
        {
          page: query.page ?? 1,
          limit: query.limit ?? PRESCRIPTION_LIST_DEFAULT_PAGE_SIZE,
          ...(query.q ? { q: query.q } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.pharmacyStage ? { pharmacyStage: query.pharmacyStage } : {}),
          ...(query.dateFrom ? { dateFrom: query.dateFrom } : {}),
          ...(query.dateTo ? { dateTo: query.dateTo } : {}),
          ...(query.patientId ? { patientId: query.patientId } : {}),
          ...(query.sort ? { sort: query.sort } : {}),
        },
        { role: req.user?.role, userId: req.user?.sub }
      );
    }
    // DOCTOR: only their own prescriptions. PHARMACIST / CLINIC_ADMIN keep the whole clinic.
    // Bounded: the most recent LEGACY_PRESCRIPTION_LIST_LIMIT rows, newest first; the headers say
    // how many exist and whether the window was cut (cache hits replay the body only).
    const doctorUserId = req.user?.role === Role.DOCTOR ? req.user.sub : undefined;
    // PHARMACIST: medicine prescriptions only (a note-only / advice prescription is never dispensed).
    const medicinesOnly = req.user?.role === Role.PHARMACIST;
    const list = await this.pharmacyService.findRecentPrescriptions(
      clinicId,
      doctorUserId ? { doctorUserId } : medicinesOnly ? { medicinesOnly } : undefined
    );
    for (const [name, value] of Object.entries(legacyPrescriptionListHeaders(list))) {
      reply.header(name, value);
    }
    return list.data;
  }

  /**
   * @endpoint GET /pharmacy/prescriptions/summary
   * @access PHARMACIST, CLINIC_ADMIN, DOCTOR (own prescriptions only)
   * @frontend prescriptions.server.ts
   * @status ACTIVE
   * @description `{ total, active, completed, cancelled, drafts, today, uniquePatients }` for
   * `dateFrom` .. `dateTo` (IST days, inclusive; none = all time). `today` is always today (IST).
   * Computed with groupBy / count, no rows loaded.
   */
  @Get('prescriptions/summary')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.DOCTOR)
  @RequireResourcePermission('prescriptions', 'read')
  @Cache({ ttl: 300, tags: ['pharmacy', 'prescriptions'], priority: 'normal', containsPHI: true })
  @RateLimitAPI()
  @ApiOperation({ summary: 'Prescription counters (status, today, distinct patients)' })
  @ApiOkResponse({ type: PrescriptionSummaryDto })
  async getPrescriptionSummary(
    @Request() req: ClinicAuthenticatedRequest,
    @Query() query: PrescriptionSummaryQueryDto
  ): Promise<PrescriptionSummaryDto> {
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.getPrescriptionSummary(
      clinicId,
      {
        ...(query.dateFrom ? { dateFrom: query.dateFrom } : {}),
        ...(query.dateTo ? { dateTo: query.dateTo } : {}),
      },
      { role: req.user?.role, userId: req.user?.sub }
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
   * @access DOCTOR (the prescribing doctor, same clinic); ASSISTANT_DOCTOR for their own DRAFT / RETURNED draft
   * @description Edit items / notes / diagnosis while the prescription is not yet dispensed
   */
  @Patch('prescriptions/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR)
  @RequireResourcePermission('prescriptions', 'update')
  @ApiOperation({
    summary:
      'Edit a not-yet-dispensed prescription (prescribing doctor; the assistant only their own DRAFT / RETURNED draft)',
  })
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
  @Roles(Role.PATIENT, Role.PHARMACIST, Role.CLINIC_ADMIN, Role.RECEPTIONIST)
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
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.PATIENT)
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
