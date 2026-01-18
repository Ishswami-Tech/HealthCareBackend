import { Controller, Get, Post, Body, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import { AppointmentQueueService } from './appointment-queue.service';

@ApiTags('queue')
@Controller('queue')
@UseGuards(JwtAuthGuard, RolesGuard, RbacGuard)
@ApiBearerAuth()
export class QueueController {
  constructor(private readonly appointmentQueueService: AppointmentQueueService) {}

  @Post('call-next')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.RECEPTIONIST)
  @ApiOperation({ summary: 'Call next patient from queue' })
  @ApiResponse({ status: 200, description: 'Next patient called successfully' })
  async callNext(@Body() body: { doctorId: string; domain?: string }) {
    if (!body.doctorId) {
      throw new BadRequestException('Doctor ID is required');
    }
    return this.appointmentQueueService.callNext(body.doctorId, body.domain || 'clinic');
  }

  @Post('reorder')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.RECEPTIONIST)
  @ApiOperation({ summary: 'Reorder queue' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        doctorId: { type: 'string' },
        date: { type: 'string' },
        newOrder: { type: 'array', items: { type: 'string' } },
        domain: { type: 'string' },
      },
    },
  })
  async reorderQueue(
    @Body()
    body: {
      doctorId: string;
      date: string;
      newOrder: string[];
      domain?: string;
    }
  ) {
    return this.appointmentQueueService.reorderQueue(
      {
        doctorId: body.doctorId,
        date: body.date,
        newOrder: body.newOrder,
      },
      body.domain || 'clinic'
    );
  }

  @Get('stats')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get queue statistics' })
  async getQueueStats(@Query('locationId') locationId: string, @Query('domain') domain?: string) {
    if (!locationId) {
      throw new BadRequestException('Location ID is required');
    }
    return this.appointmentQueueService.getLocationQueueStats(locationId, domain || 'clinic');
  }

  @Post('pause')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Pause queue' })
  async pauseQueue(@Body() body: { doctorId: string; domain?: string }) {
    return this.appointmentQueueService.pauseQueue(body.doctorId, body.domain || 'clinic');
  }

  @Post('resume')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Resume queue' })
  async resumeQueue(@Body() body: { doctorId: string; domain?: string }) {
    return this.appointmentQueueService.resumeQueue(body.doctorId, body.domain || 'clinic');
  }
}
