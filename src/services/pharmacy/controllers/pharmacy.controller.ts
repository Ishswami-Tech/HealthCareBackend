import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PharmacyService } from '../services/pharmacy.service';
import {
  CreateMedicineDto,
  UpdateInventoryDto,
  CreatePrescriptionDto,
  UpdatePrescriptionStatusDto,
  PharmacyStatsDto,
  CreateSupplierDto,
  UpdateSupplierDto,
} from '@dtos/pharmacy.dto';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
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

  /**
   * @endpoint GET /pharmacy/inventory
   * @access PHARMACIST, CLINIC_ADMIN, SUPER_ADMIN
   * @frontend pharmacy.server.ts
   * @status ACTIVE
   * @description Get all medicines in pharmacy inventory
   */
  @Get('inventory')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('inventory', 'read')
  @Cache({ ttl: 300, tags: ['pharmacy', 'inventory'], priority: 'normal' })
  @RateLimitAPI()
  @ApiOperation({ summary: 'Get all medicines in inventory' })
  async getInventory(@Request() req: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.findAllMedicines(clinicId);
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
    return this.pharmacyService.addMedicine(dto, clinicId);
  }

  /**
   * @endpoint PATCH /pharmacy/inventory/:id
   * @access PHARMACIST, CLINIC_ADMIN
   * @frontend NONE
   * @status ADMIN_ONLY
   * @description Update medicine inventory (stock/price)
   * @note Used by admin panel (not yet implemented in main app)
   */
  @Patch('inventory/:id')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN)
  @RequireResourcePermission('inventory', 'update')
  @ApiOperation({ summary: 'Update medicine stock or price' })
  async updateInventory(
    @Param('id') id: string,
    @Body() dto: UpdateInventoryDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.updateInventory(id, dto, clinicId);
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
    return this.pharmacyService.findAllPrescriptions(clinicId);
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
    @Body() dto: CreatePrescriptionDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.createPrescription(dto, clinicId);
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
    return this.pharmacyService.updatePrescriptionStatus(id, dto.status, clinicId);
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
  @Cache({ ttl: 1800, tags: ['pharmacy', 'stats'], priority: 'low' })
  @RateLimitAPI()
  @ApiOperation({ summary: 'Get pharmacy statistical summary' })
  async getStats(@Request() req: ClinicAuthenticatedRequest): Promise<PharmacyStatsDto> {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.pharmacyService.getStats(clinicId);
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
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('inventory', 'create')
  @ApiOperation({ summary: 'Add a new supplier' })
  async addSupplier(@Body() dto: CreateSupplierDto, @Request() req: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required');
    return this.pharmacyService.addSupplier(dto, clinicId);
  }

  @Patch('suppliers/:id')
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
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
   * @ownership Patients can only view their own prescriptions
   * @note Fixed dashboard redirect loop issue
   */
  @Get('prescriptions/patient/:userId')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.DOCTOR, Role.PATIENT)
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
    @Request() req: Request & { user?: { sub?: string; role?: string } }
  ) {
    // Patients can only view their own prescriptions
    if (req.user?.role === 'PATIENT' && req.user?.sub !== userId) {
      throw new ForbiddenException('Patients can only view their own prescriptions');
    }
    return this.pharmacyService.findPrescriptionsByPatient(userId);
  }
}
