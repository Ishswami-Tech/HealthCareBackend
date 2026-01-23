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

  @Get('inventory')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get all medicines in inventory' })
  async getInventory() {
    return this.pharmacyService.findAllMedicines();
  }

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

  @Patch('inventory/:id')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Update medicine stock or price' })
  async updateInventory(@Param('id') id: string, @Body() dto: UpdateInventoryDto) {
    return this.pharmacyService.updateInventory(id, dto);
  }

  @Get('prescriptions')
  @Roles(Role.PHARMACIST)
  @ApiOperation({ summary: 'Get all prescriptions' })
  async getPrescriptions(@Request() req: Request & { user?: { clinicId?: string } }) {
    const clinicId = req.user?.clinicId;
    return this.pharmacyService.findAllPrescriptions(clinicId);
  }

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

  @Get('dashboard/stats')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Get pharmacy dashboard statistics' })
  async getStats(): Promise<PharmacyStatsDto> {
    return this.pharmacyService.getStats();
  }

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
