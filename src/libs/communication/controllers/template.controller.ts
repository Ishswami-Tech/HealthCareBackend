import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Patch,
  Delete,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CommunicationTemplateService } from '../services/communication-template.service';
import {
  CreateCommunicationTemplateDto,
  UpdateCommunicationTemplateDto,
} from '@dtos/notification.dto';
import { Roles } from '@core/decorators/roles.decorator';
import { RoleEnum as Role, AuthenticatedRequest } from '@core/types';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';

@ApiTags('communication')
@Controller('communication/templates')
@UseGuards(JwtAuthGuard)
export class TemplateController {
  constructor(private readonly templateService: CommunicationTemplateService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('notifications', 'create')
  @ApiOperation({ summary: 'Create a new communication template' })
  async createTemplate(
    @Body() dto: CreateCommunicationTemplateDto,
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user.id;
    const clinicId = req.user.clinicId;
    return this.templateService.createTemplate(dto, userId, clinicId);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.DOCTOR, Role.RECEPTIONIST)
  @RequireResourcePermission('notifications', 'read')
  @ApiOperation({ summary: 'Get all communication templates' })
  async getTemplates(@Request() req: AuthenticatedRequest) {
    const clinicId = req.user.clinicId;
    return this.templateService.getTemplates(clinicId);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.DOCTOR, Role.RECEPTIONIST)
  @RequireResourcePermission('notifications', 'read')
  @ApiOperation({ summary: 'Get a communication template by ID' })
  async getTemplateById(@Param('id') id: string) {
    return this.templateService.getTemplateById(id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('notifications', 'update')
  @ApiOperation({ summary: 'Update a communication template' })
  async updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateCommunicationTemplateDto,
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user.id;
    const clinicId = req.user.clinicId as string;
    return this.templateService.updateTemplate(id, dto, userId, clinicId);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('notifications', 'delete')
  @ApiOperation({ summary: 'Delete a communication template' })
  async deleteTemplate(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const userId = req.user.id;
    const clinicId = req.user.clinicId as string;
    return this.templateService.deleteTemplate(id, userId, clinicId);
  }
}
