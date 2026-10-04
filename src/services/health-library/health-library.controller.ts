/**
 * Health Library Controller
 *
 *   GET    health-library                    list (patients see PUBLISHED only)
 *   GET    health-library/:id                get one (counts a view for non-author readers of PUBLISHED posts,
 *                                            at most once per reader per post per hour)
 *   POST   health-library                    create (DRAFT) — DOCTOR/RECEPTIONIST/CLINIC_ADMIN/SUPER_ADMIN
 *   PATCH  health-library/:id                edit content fields — same author roles
 *   POST   health-library/:id/publish        DRAFT|ARCHIVED -> PUBLISHED (409 if already published or lost a concurrent publish)
 *   POST   health-library/:id/archive        DRAFT|PUBLISHED -> ARCHIVED (409 if already archived or lost a concurrent archive)
 *   POST   health-library/:id/cover-image    multipart cover image upload (409 if the cover keeps being
 *                                            replaced by concurrent uploads; the new object is then discarded)
 *   DELETE health-library/:id                soft delete — DOCTOR/CLINIC_ADMIN/SUPER_ADMIN only
 */

import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import {
  CreateHealthLibraryPostDto,
  ListHealthLibraryQueryDto,
  UpdateHealthLibraryPostDto,
} from '@dtos/health-library.dto';
import type {
  HealthLibraryListResponse,
  HealthLibraryPostResponse,
} from '@dtos/health-library.dto';
import { FastifyFile } from '@services/patient-visits/utils/fastify-file.decorator';
import type { MulterFile } from '@services/patient-visits/utils/fastify-file.decorator';
import { HealthLibraryService } from '@services/health-library/health-library.service';
import type { HealthLibraryActor } from '@services/health-library/health-library.types';

const AUTHOR_ROLES: Role[] = [Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN];
const DELETE_ROLES: Role[] = [Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN];

const COVER_IMAGE_BODY_SCHEMA = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary' } },
  },
};

@ApiTags('health-library')
@Controller('health-library')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
export class HealthLibraryController {
  constructor(private readonly healthLibraryService: HealthLibraryService) {}

  @Get()
  @ApiOperation({ summary: 'List health library posts (patients see published content only)' })
  async list(
    @Query() query: ListHealthLibraryQueryDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<HealthLibraryListResponse> {
    return this.healthLibraryService.list(query, this.requireClinic(req), this.isAuthor(req));
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single health library post (patients reading a published post count as a view)',
  })
  async getById(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<HealthLibraryPostResponse> {
    return this.healthLibraryService.getById(
      id,
      this.requireClinic(req),
      this.isAuthor(req),
      this.actor(req)
    );
  }

  @Post()
  @Roles(...AUTHOR_ROLES)
  @ApiOperation({ summary: 'Create a health library post (always starts as DRAFT)' })
  async create(
    @Body() dto: CreateHealthLibraryPostDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<HealthLibraryPostResponse> {
    return this.healthLibraryService.create(dto, this.requireClinic(req), this.actor(req));
  }

  @Patch(':id')
  @Roles(...AUTHOR_ROLES)
  @ApiOperation({ summary: "Update a health library post's content fields" })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateHealthLibraryPostDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<HealthLibraryPostResponse> {
    return this.healthLibraryService.update(id, this.requireClinic(req), dto, this.actor(req));
  }

  @Post(':id/publish')
  @Roles(...AUTHOR_ROLES)
  @ApiOperation({ summary: 'Publish a draft or archived post' })
  async publish(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<HealthLibraryPostResponse> {
    return this.healthLibraryService.publish(id, this.requireClinic(req), this.actor(req));
  }

  @Post(':id/archive')
  @Roles(...AUTHOR_ROLES)
  @ApiOperation({ summary: 'Archive a post (hides it from patients without deleting it)' })
  async archive(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<HealthLibraryPostResponse> {
    return this.healthLibraryService.archive(id, this.requireClinic(req), this.actor(req));
  }

  @Post(':id/cover-image')
  @Roles(...AUTHOR_ROLES)
  @ApiConsumes('multipart/form-data')
  @ApiBody(COVER_IMAGE_BODY_SCHEMA)
  @ApiOperation({ summary: 'Upload / replace the cover image' })
  async setCoverImage(
    @Param('id') id: string,
    @FastifyFile() file: MulterFile | null,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<HealthLibraryPostResponse> {
    return this.healthLibraryService.setCoverImage(
      id,
      this.requireClinic(req),
      file,
      this.actor(req)
    );
  }

  @Delete(':id')
  @Roles(...DELETE_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a post' })
  async remove(@Param('id') id: string, @Request() req: ClinicAuthenticatedRequest): Promise<void> {
    await this.healthLibraryService.softDelete(id, this.requireClinic(req), this.actor(req));
  }

  private requireClinic(req: ClinicAuthenticatedRequest): string {
    const clinicId = req.clinicContext?.clinicId ?? req.user?.clinicId;
    if (!clinicId) {
      throw new ForbiddenException('Clinic context required');
    }
    return clinicId;
  }

  private actor(req: ClinicAuthenticatedRequest): HealthLibraryActor {
    return {
      ...(req.user?.id || req.user?.sub ? { userId: req.user.id ?? req.user.sub } : {}),
      ...(req.user?.role ? { role: req.user.role } : {}),
    };
  }

  private isAuthor(req: ClinicAuthenticatedRequest): boolean {
    const role = req.user?.role;
    return !!role && AUTHOR_ROLES.includes(role as Role);
  }
}
