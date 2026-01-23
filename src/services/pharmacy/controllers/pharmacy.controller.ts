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
  PharmacyStatsDto,
} from '@dtos/pharmacy.dto';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';

@ApiTags('pharmacy')
@Controller('pharmacy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
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
  @ApiOperation({ summary: 'Get all medicines in inventory' })
  async getInventory() {
    return this.pharmacyService.findAllMedicines();
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
  @ApiOperation({ summary: 'Add new medicine to inventory' })
  async addMedicine(
    @Body() dto: CreateMedicineDto,
    @Request() req: Request & { user?: { clinicId?: string } }
  ) {
    const headers = req.headers as unknown as Record<string, string | string[] | undefined>;
    const clinicId = req.user?.clinicId || (headers['x-clinic-id'] as string | undefined);
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
  @ApiOperation({ summary: 'Update medicine stock or price' })
  async updateInventory(@Param('id') id: string, @Body() dto: UpdateInventoryDto) {
    return this.pharmacyService.updateInventory(id, dto);
  }

  /**
   * @endpoint GET /pharmacy/prescriptions
   * @access PHARMACIST
   * @frontend pharmacy.server.ts
   * @status ACTIVE
   * @description Get all prescriptions for pharmacist review
   */
  @Get('prescriptions')
  @Roles(Role.PHARMACIST)
  @ApiOperation({ summary: 'Get all prescriptions' })
  async getPrescriptions(@Request() req: Request & { user?: { clinicId?: string } }) {
    const clinicId = req.user?.clinicId;
    return this.pharmacyService.findAllPrescriptions(clinicId);
  }

  /**
   * @endpoint POST /pharmacy/prescriptions
   * @access DOCTOR
   * @frontend pharmacy.server.ts
   * @status ACTIVE
   * @description Create new prescription for patient
   */
  @Post('prescriptions')
  @Roles(Role.DOCTOR)
  @ApiOperation({ summary: 'Create a new prescription' })
  async createPrescription(
    @Body() dto: CreatePrescriptionDto,
    @Request() req: Request & { user?: { clinicId?: string } }
  ) {
    const clinicId = req.user?.clinicId;
    return this.pharmacyService.createPrescription(dto, clinicId);
  }

  /**
   * @endpoint GET /pharmacy/dashboard/stats
   * @access PHARMACIST, CLINIC_ADMIN
   * @frontend NONE
   * @status ADMIN_ONLY
   * @description Get pharmacy statistics for admin dashboard
   * @note Used by admin panel (not yet implemented in main app)
   */
  @Get('dashboard/stats')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Get pharmacy dashboard statistics' })
  async getStats(): Promise<PharmacyStatsDto> {
    return this.pharmacyService.getStats();
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
  @Roles(Role.PATIENT, Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
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
