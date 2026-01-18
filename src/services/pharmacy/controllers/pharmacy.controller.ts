import { Controller, Get, Post, Body, Patch, Param, UseGuards } from '@nestjs/common';
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
  async addMedicine(@Body() dto: CreateMedicineDto) {
    return this.pharmacyService.addMedicine(dto);
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
  async getPrescriptions() {
    return this.pharmacyService.findAllPrescriptions();
  }

  @Post('prescriptions')
  @Roles(Role.DOCTOR)
  @ApiOperation({ summary: 'Create a new prescription' })
  async createPrescription(@Body() dto: CreatePrescriptionDto) {
    return this.pharmacyService.createPrescription(dto);
  }

  @Get('dashboard/stats')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Get pharmacy dashboard statistics' })
  async getStats(): Promise<PharmacyStatsDto> {
    return this.pharmacyService.getStats();
  }
}
