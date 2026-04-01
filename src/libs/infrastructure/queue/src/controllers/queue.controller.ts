import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Job } from 'bullmq';
import { Roles } from '@core/decorators/roles.decorator';
import { RequiresProfileCompletion } from '@core/decorators/profile-completion.decorator';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { ProfileCompletionGuard } from '@core/guards/profile-completion.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { Role } from '@core/types/enums.types';
import { QueueMonitoringService } from '../monitoring/queue-monitoring.service';
import type {
  ManualQueueAlertCreateInput,
  ManualQueueAlertUpdateInput,
} from '../monitoring/queue-monitoring.service';
import { QueueService } from '../queue.service';
import { HEALTHCARE_QUEUE } from '../queue.constants';
import { JobType } from '@core/types/queue.types';
import { AppointmentQueueService } from '../services/appointment-queue.service';

interface QueueQuery {
  type?: string;
  status?: string;
  doctorId?: string;
  queueName?: string;
  locationId?: string;
  date?: string;
  limit?: string;
}

interface QueueAddBody {
  patientId: string;
  appointmentId?: string;
  queueType: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  doctorId?: string;
  queueOwnerId?: string;
  locationId?: string;
  notes?: string;
  clinicId?: string;
}

export interface NotificationQueueQuery {
  status?: 'all' | 'read' | 'unread';
  userId?: string;
  clinicId?: string;
  limit?: string;
}

export interface NotificationQueueBody {
  notificationId: string;
  userId: string;
  title: string;
  message: string;
  type?: string;
  clinicId?: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  audienceRoles?: string[];
  metadata?: Record<string, unknown>;
}

interface QueueEntryLike {
  id?: string;
  entryId?: string;
  appointmentId?: string;
  patientId?: string;
  doctorId?: string;
  clinicId?: string;
  queueName?: string;
  queueType?: string;
  queueCategory?: string;
  queueOwnerId?: string;
  status?: string;
  locationId?: string;
  checkedInAt?: string;
  startedAt?: string;
  completedAt?: string;
  notes?: string;
  type?: string;
  raw?: Record<string, unknown>;
  position?: number;
  queuePosition?: number;
  totalInQueue?: number;
}

interface QueueConfigBody {
  queueName?: string;
  queueType?: string;
  clinicId?: string;
  maxWaitTime?: number;
  averageConsultationTime?: number;
  autoCallNext?: boolean;
  allowWalkIns?: boolean;
  priorityEnabled?: boolean;
}

type QueueCapacityBody = {
  queueName?: string;
  queueType?: string;
  clinicId?: string;
  capacity: number;
};

interface QueueCapacityQuery {
  type?: string;
  queueName?: string;
  queueType?: string;
  clinicId?: string;
}

interface QueueExportRequest {
  queueName?: string;
  queueType?: string;
  type?: string;
  clinicId?: string;

  startDate?: string;
  endDate?: string;
  status?: string;
  format?: 'json' | 'csv' | 'excel' | 'pdf';
  limit?: string;
}

type QueueExportInput = QueueExportRequest;

export type NotificationQueueLike = {
  id?: string;
  notificationId?: string;
  userId?: string;
  clinicId?: string;
  title?: string;
  message?: string;
  type?: string;
  status?: string;
  readAt?: string;
  readByUserId?: string;
  readByRole?: string;
  audienceRoles?: string[];
  queueName?: string;
  jobState?: string;
  createdAt?: string;
  updatedAt?: string;
  raw?: Record<string, unknown>;
};

@ApiTags('queue')
@Controller('queue')
@UseGuards(JwtAuthGuard, ClinicGuard, RolesGuard, RbacGuard, ProfileCompletionGuard)
@RequiresProfileCompletion()
@ApiBearerAuth()
export class QueueController {
  constructor(
    private readonly appointmentQueueService: AppointmentQueueService,
    private readonly queueService: QueueService,
    private readonly queueMonitoringService: QueueMonitoringService
  ) {}

  @Get()
  @Roles(
    Role.DOCTOR,
    Role.NURSE,
    Role.ASSISTANT_DOCTOR,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD,
    Role.PATIENT
  )
  @ApiOperation({ summary: 'List queue entries' })
  async listQueue(
    @Query() query: QueueQuery,
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: QueueEntryLike[]; meta: Record<string, unknown> }> {
    const clinicId = this.requireClinicId(req);
    const domain = 'clinic' as const;

    const statuses = this.parseStatuses(query.status);

    if (query.doctorId) {
      const date = this.safeDate(query.date || this.today());
      const doctorQueue = await this.appointmentQueueService.getDoctorQueue(
        query.doctorId,
        clinicId,
        date,
        domain
      );
      const data = doctorQueue.queue
        .map((entry, index) =>
          this.operationalEntry(
            entry as unknown as QueueEntryLike,
            index + 1,
            doctorQueue.queue.length
          )
        )
        .filter(entry => this.matchEntry(entry, query));
      return { success: true, data, meta: { clinicId, domain, total: data.length } };
    }

    const queueNames = this.resolveQueueNames(query.queueName);
    const rows: QueueEntryLike[] = [];
    for (const queueName of queueNames) {
      const jobs = await this.queueService.getJobs(queueName, { status: statuses, domain });
      rows.push(...jobs.map((job, idx) => this.jobEntry(job, idx + 1, jobs.length, clinicId)));
    }
    const data = rows.filter(entry => this.matchEntry(entry, query));
    const limit = query.limit ? Math.max(1, Number(query.limit)) : 100;
    return {
      success: true,
      data: data.slice(0, limit),
      meta: { clinicId, domain, total: data.length },
    };
  }

  @Post('add')
  @Roles(
    Role.DOCTOR,
    Role.NURSE,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Add to queue' })
  async addQueue(
    @Body() body: QueueAddBody,
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: unknown; message: string }> {
    this.requireString(body.patientId, 'patientId');
    this.requireString(body.queueType, 'queueType');
    const clinicId = this.requireClinicId(req, body.clinicId);
    const domain = 'clinic' as const;

    const queueOwnerId = this.pick(body.queueOwnerId, body.doctorId);
    if (queueOwnerId) {
      const job = await this.queueService.addJob(
        JobType.APPOINTMENT,
        'queue.enqueue',
        {
          appointmentId: body.appointmentId || body.patientId,
          patientId: body.patientId,
          clinicId,
          doctorId: body.doctorId,
          queueOwnerId,
          queueCategory: this.toQueueCategory(body.queueType),
          notes: body.notes,
          queueType: body.queueType,
          domain,
        },
        { priority: this.jobPriority(body.priority) }
      );
      return { success: true, data: { jobId: job.id }, message: 'Added to queue' };
    }

    const queueName = this.queueNameFromType(body.queueType);
    const job = await this.queueService.addJob(
      JobType.APPOINTMENT,
      'create',
      {
        patientId: body.patientId,
        appointmentId: body.appointmentId || body.patientId,
        queueType: body.queueType,
        clinicId,
        locationId: body.locationId,
        notes: body.notes,
        status: 'WAITING',
        domain,
      },
      {
        priority: this.jobPriority(body.priority),
        correlationId: body.appointmentId || body.patientId,
      }
    );
    return { success: true, data: { jobId: job.id, queueName }, message: 'Patient added to queue' };
  }

  @Patch(':patientId/status')
  @Roles(
    Role.DOCTOR,
    Role.NURSE,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD,
    Role.THERAPIST,
    Role.COUNSELOR
  )
  @ApiOperation({ summary: 'Update queue status' })
  async updateQueueStatus(
    @Param('patientId') patientId: string,
    @Body() body: { status: string; queueName?: string },
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: unknown; message: string }> {
    this.requireString(patientId, 'patientId');
    this.requireString(body.status, 'status');
    const clinicId = this.requireClinicId(req);
    const domain = 'clinic' as const;

    const status = body.status.toUpperCase();

    const context = await this.safeContext(patientId, clinicId, domain);
    if (context?.doctorId) {
      if (status === 'CONFIRMED') {
        const job = await this.queueService.addJob(JobType.APPOINTMENT, 'queue.confirm', {
          patientId,
          clinicId,
          domain,
        });
        return { success: true, data: { jobId: job.id }, message: 'Queue status update enqueued' };
      }
      if (status === 'IN_PROGRESS') {
        const job = await this.queueService.addJob(
          JobType.APPOINTMENT,
          'queue.start_consultation',
          { patientId, doctorId: context.doctorId, clinicId, domain }
        );
        return { success: true, data: { jobId: job.id }, message: 'Queue status update enqueued' };
      }
      if (status === 'COMPLETED' || status === 'CANCELLED' || status === 'NO_SHOW') {
        const action =
          status === 'CANCELLED'
            ? 'queue.cancel'
            : status === 'NO_SHOW'
              ? 'queue.no_show'
              : 'queue.complete';
        const job = await this.queueService.addJob(JobType.APPOINTMENT, action, {
          patientId,
          doctorId: context.doctorId,
          clinicId,
          domain,
        });
        return { success: true, data: { jobId: job.id }, message: 'Queue status update enqueued' };
      }
    }

    const jobHit = await this.findJob(patientId, body.queueName);
    if (!jobHit) throw new BadRequestException('Queue entry not found');
    const updated = await this.queueService.updateJob(jobHit.queueName, patientId, {
      ...this.jobData(jobHit.job),
      status,
      updatedAt: new Date().toISOString(),
    });
    return {
      success: true,
      data: { updated, queueName: jobHit.queueName },
      message: 'Queue status updated',
    };
  }

  @Patch(':entryId/transfer')
  @Roles(
    Role.NURSE,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Transfer patient to a different queue (logical queue move)' })
  async transferQueueEntry(
    @Param('entryId') entryId: string,
    @Body() body: { targetQueue: string; treatmentType?: string; notes?: string },
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: unknown; message: string }> {
    this.requireString(entryId, 'entryId');
    this.requireString(body.targetQueue, 'targetQueue');
    const clinicId = this.requireClinicId(req);
    const domain = 'clinic' as const;

    const job = await this.queueService.addJob(JobType.APPOINTMENT, 'queue.transfer', {
      entryId,
      targetQueue: body.targetQueue.toUpperCase(),
      treatmentType: body.treatmentType,
      notes: body.notes,
      clinicId,
      domain,
    });

    return {
      success: true,
      data: { jobId: job.id },
      message: `Patient transfer to ${body.targetQueue} enqueued`,
    };
  }

  @Post('call-next')
  @Roles(
    Role.DOCTOR,
    Role.NURSE,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Call next patient' })
  async callNext(
    @Body() body: { doctorId: string; appointmentId: string },
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: unknown; message: string }> {
    this.requireString(body.doctorId, 'doctorId');
    this.requireString(body.appointmentId, 'appointmentId');
    const clinicId = this.requireClinicId(req);
    const job = await this.queueService.addJob(JobType.APPOINTMENT, 'queue.call_next', {
      doctorId: body.doctorId,
      clinicId,
      domain: 'clinic',
      appointmentId: body.appointmentId,
    });

    return { success: true, data: { jobId: job.id }, message: 'Call next enqueued' };
  }

  @Post('reorder')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Reorder queue' })
  async reorder(
    @Body() body: { doctorId: string; date: string; newOrder: string[] },
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<unknown> {
    this.requireString(body.doctorId, 'doctorId');
    this.requireString(body.date, 'date');
    if (!Array.isArray(body.newOrder) || body.newOrder.length === 0)
      throw new BadRequestException('newOrder is required');
    const clinicId = this.requireClinicId(req);
    const job = await this.queueService.addJob(JobType.APPOINTMENT, 'queue.reorder', {
      doctorId: body.doctorId,
      clinicId,
      date: this.safeDate(body.date),
      newOrder: body.newOrder,
      domain: 'clinic',
    });
    return { success: true, data: { jobId: job.id }, message: 'Reorder enqueued' };
  }

  @Delete(':queueId')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Remove queue entry' })
  async removeQueue(
    @Param('queueId') queueId: string,
    @Query('doctorId') doctorId: string | undefined,
    @Query('domain') domain: string | undefined,
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: unknown; message: string }> {
    this.requireString(queueId, 'queueId');
    const clinicId = this.requireClinicId(req);
    const normalizedDomain = 'clinic' as const;

    const context = await this.safeContext(queueId, clinicId, normalizedDomain);
    const resolvedDoctorId = this.pick(doctorId, context?.doctorId);
    if (resolvedDoctorId) {
      const job = await this.queueService.addJob(JobType.APPOINTMENT, 'queue.remove', {
        patientId: queueId,
        doctorId: resolvedDoctorId,
        clinicId,
        domain: normalizedDomain,
      });
      return { success: true, data: { jobId: job.id }, message: 'Remove enqueued' };
    }
    const jobHit = await this.findJob(queueId);
    if (!jobHit) throw new BadRequestException('Queue entry not found');
    const removed = await this.queueService.removeJob(jobHit.queueName, queueId);
    return {
      success: true,
      data: { removed, queueName: jobHit.queueName },
      message: removed ? 'Removed' : 'Not found',
    };
  }

  @Get('stats')
  @Roles(
    Role.DOCTOR,
    Role.NURSE,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Queue stats' })
  async getQueueStats(
    @Query('locationId') locationId: string,
    @Query('domain') domain: string | undefined,
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: unknown }> {
    this.requireString(locationId, 'locationId');
    const clinicId = this.requireClinicId(req);
    const data = await this.appointmentQueueService.getLocationQueueStats(
      locationId,
      clinicId,
      'clinic'
    );

    return { success: true, data };
  }

  @Get('history')
  @Roles(
    Role.DOCTOR,
    Role.NURSE,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Queue history' })
  async history(
    @Query() query: QueueQuery,
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<unknown> {
    return this.listQueue(query, req);
  }

  @Get('analytics')
  @Roles(
    Role.DOCTOR,
    Role.NURSE,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Queue analytics' })
  async analytics(
    @Query() query: { period?: string; startDate?: string; endDate?: string },
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: unknown }> {
    this.requireClinicId(req);
    const period = ['day', 'week', 'month', 'year'].includes(query.period || '')
      ? (query.period as string)
      : 'day';
    const startDate = query.startDate
      ? new Date(query.startDate)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();
    const data = await this.queueMonitoringService.generatePerformanceReport(
      period,
      startDate,
      endDate
    );
    return { success: true, data };
  }

  @Get('performance')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Queue performance' })
  async performance(): Promise<{ success: true; data: unknown }> {
    const data = await this.queueService.getPerformanceMetrics();
    return { success: true, data };
  }

  @Get('wait-times')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Queue wait times' })
  async waitTimes(
    @Query() query: { queueName?: string }
  ): Promise<{ success: true; data: unknown[] }> {
    const queueNames = this.resolveQueueNames(query.queueName);
    const data = await Promise.all(queueNames.map(name => this.queueService.getQueueMetrics(name)));
    return { success: true, data };
  }

  @Post('estimate-wait-time')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Estimate wait time' })
  async estimateWaitTime(
    @Body() body: { queueType?: string; priority?: string }
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const queueName = this.queueNameFromType(body.queueType || HEALTHCARE_QUEUE);
    const metrics = await this.queueService.getQueueMetrics(queueName);
    const base = Math.max(1, Math.round(metrics.averageProcessingTime / 60000));
    const wait = Math.max(
      0,
      (metrics.waiting + metrics.active) * base * this.priorityWeight(body.priority)
    );
    return {
      success: true,
      data: {
        queueType: body.queueType || queueName,
        estimatedWaitTime: Math.round(wait),
        baseWaitTime: base,
      },
    };
  }

  @Get('capacity')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Queue capacity' })
  async capacity(
    @Query() query: QueueCapacityQuery,
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: unknown }> {
    const clinicId = this.requireClinicId(req, query.clinicId);
    const queueType = this.pick(query.queueType, query.queueName, query.type);
    const data = await this.queueService.getQueueCapacity(queueType, clinicId);
    return { success: true, data };
  }

  @Post('pause')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Pause queue' })
  async pause(
    @Body() body: { doctorId: string; domain?: string },
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: unknown }> {
    this.requireString(body.doctorId, 'doctorId');
    const clinicId = this.requireClinicId(req);
    const job = await this.queueService.addJob(JobType.APPOINTMENT, 'queue.pause', {
      doctorId: body.doctorId,
      clinicId,
      domain: 'clinic',
    });

    return { success: true, data: { jobId: job.id } };
  }

  @Post('resume')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Resume queue' })
  async resume(
    @Body() body: { doctorId: string; domain?: string },
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: unknown }> {
    this.requireString(body.doctorId, 'doctorId');
    const clinicId = this.requireClinicId(req);
    const job = await this.queueService.addJob(JobType.APPOINTMENT, 'queue.resume', {
      doctorId: body.doctorId,
      clinicId,
      domain: 'clinic',
    });

    return { success: true, data: { jobId: job.id } };
  }

  @Get('alerts')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Queue alerts' })
  alerts(
    @Query() query: { queueName?: string; severity?: 'low' | 'medium' | 'high' | 'critical' }
  ): { success: true; data: unknown } {
    const data = query.queueName
      ? this.queueMonitoringService.getAlertsByQueue(query.queueName)
      : query.severity
        ? this.queueMonitoringService.getAlertsBySeverity(query.severity)
        : this.queueMonitoringService.getActiveAlerts();
    return { success: true, data };
  }

  @Post('alerts')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Create queue alert' })
  async createAlert(
    @Body() body: ManualQueueAlertCreateInput
  ): Promise<{ success: true; data: unknown; message: string }> {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Request body is required');
    }

    const data = await this.queueMonitoringService.createAlertManual(body);
    return { success: true, data, message: 'Alert created' };
  }

  @Patch('alerts/:alertId')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Update queue alert' })
  async updateAlert(
    @Param('alertId') alertId: string,
    @Body() body: ManualQueueAlertUpdateInput
  ): Promise<{ success: true; data: unknown; message: string }> {
    this.requireString(alertId, 'alertId');
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Request body is required');
    }

    const data = await this.queueMonitoringService.updateAlertManual(alertId, body);
    return { success: true, data, message: 'Alert updated' };
  }

  @Delete('alerts/:alertId')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Delete queue alert' })
  async deleteAlert(
    @Param('alertId') alertId: string
  ): Promise<{ success: true; data: unknown; message: string }> {
    this.requireString(alertId, 'alertId');
    const data = await this.queueMonitoringService.deleteAlertManual(alertId);
    return { success: true, data, message: 'Alert deleted' };
  }

  @Get('config')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Queue config' })
  async config(@Req() req: ClinicAuthenticatedRequest): Promise<{ success: true; data: unknown }> {
    const clinicId = this.requireClinicId(req);
    const data = await this.queueService.getQueueConfig(clinicId);
    return { success: true, data };
  }

  @Get('notifications')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'List queue notifications' })
  async listNotifications(
    @Query() query: NotificationQueueQuery,
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: NotificationQueueLike[]; meta: Record<string, unknown> }> {
    const clinicId = this.requireClinicId(req);
    const status = this.parseNotificationStatus(query.status);
    const limit = this.parseLimit(query.limit, 100);
    const jobs = await this.queueService.getJobs(HEALTHCARE_QUEUE, {
      status: ['waiting', 'active', 'completed', 'failed', 'delayed'],
    });

    const notifications = await Promise.all(jobs.map(job => this.notificationEntry(job)));
    const data = notifications.filter(notification =>
      this.matchesNotification(notification, query, clinicId, status, req)
    );

    return {
      success: true,
      data: data.slice(0, limit),
      meta: {
        clinicId,
        queueName: HEALTHCARE_QUEUE,
        limit,
        status,
        total: data.length,
      },
    };
  }

  @Post('notifications')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Queue notification send job' })
  async createNotification(
    @Body() body: NotificationQueueBody,
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: NotificationQueueLike; message: string }> {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Request body is required');
    }

    this.requireString(body.notificationId, 'notificationId');
    this.requireString(body.userId, 'userId');
    this.requireString(body.title, 'title');
    this.requireString(body.message, 'message');

    const clinicId = this.requireClinicId(req, body.clinicId);
    const notificationId = body.notificationId.trim();
    const now = new Date().toISOString();
    const job = await this.queueService.addJob(
      JobType.NOTIFICATION,
      'notification_send',
      {
        notificationId,
        id: notificationId,
        userId: body.userId.trim(),
        clinicId,
        title: body.title.trim(),
        message: body.message.trim(),
        type: body.type?.trim() || 'SYSTEM',
        status: 'QUEUED',
        readAt: null,
        readByUserId: null,
        readByRole: null,
        audienceRoles: this.normalizeRoles(body.audienceRoles),
        metadata: this.normalizeMetadata(body.metadata),
        createdAt: now,
        updatedAt: now,
      },
      {
        correlationId: notificationId,
        priority: this.jobPriority(body.priority),
        removeOnComplete: false,
        removeOnFail: false,
      }
    );

    const data = await this.notificationEntry(job);
    return { success: true, data, message: 'Notification queued' };
  }

  @Patch('notifications/:notificationId/read')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Mark queue notification as read' })
  async markNotificationRead(
    @Param('notificationId') notificationId: string,
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: NotificationQueueLike; message: string }> {
    this.requireString(notificationId, 'notificationId');
    const clinicId = this.requireClinicId(req);
    const existingJob = await this.queueService.getJob(HEALTHCARE_QUEUE, notificationId);
    if (!existingJob) {
      throw new BadRequestException('Notification not found');
    }

    const existingNotification = await this.notificationEntry(existingJob);
    if (!this.canAccessNotification(existingNotification, req, clinicId)) {
      throw new BadRequestException('Notification not found');
    }

    const now = new Date().toISOString();
    const updatedJob = await this.queueService.patchJobData(HEALTHCARE_QUEUE, notificationId, {
      status: 'READ',
      readAt: now,
      readByUserId: this.currentUserId(req),
      readByRole: this.currentUserRole(req),
      updatedAt: now,
    });

    if (!updatedJob) {
      throw new BadRequestException('Notification not found');
    }

    const data = await this.notificationEntry(updatedJob);
    return { success: true, data, message: 'Notification marked as read' };
  }

  @Patch(':queueId/position')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Update queue position' })
  async updateQueuePosition(
    @Param('queueId') queueId: string,
    @Body() body: { position: number; doctorId?: string; date?: string },
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: unknown; message: string }> {
    this.requireString(queueId, 'queueId');
    if (!Number.isInteger(body.position) || body.position <= 0) {
      throw new BadRequestException('position must be a positive integer');
    }
    const clinicId = this.requireClinicId(req);
    const domain = 'clinic' as const;

    const date = this.safeDate(body.date || this.today());
    const context = await this.safeContext(queueId, clinicId, domain);
    const doctorId = this.pick(body.doctorId, context?.doctorId);
    if (!doctorId) {
      throw new BadRequestException('doctorId is required for queue reorder');
    }

    const queue = await this.appointmentQueueService.getDoctorQueue(
      doctorId,
      clinicId,
      date,
      domain
    );
    const current = queue.queue.filter(entry => entry.appointmentId !== queueId);
    const moving = queue.queue.find(entry => entry.appointmentId === queueId);
    if (!moving) {
      throw new BadRequestException('Queue entry not found in doctor queue');
    }
    current.splice(Math.min(body.position - 1, current.length), 0, moving);
    const data = await this.appointmentQueueService.reorderQueue(
      {
        doctorId,
        clinicId,
        date,
        newOrder: current.map(entry => entry.appointmentId),
      },
      domain
    );
    return { success: true, data, message: 'Queue position updated' };
  }

  @Patch('config')
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.CLINIC_LOCATION_HEAD)
  @ApiOperation({ summary: 'Update queue config' })
  async updateQueueConfig(
    @Body() body: QueueConfigBody,
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: unknown; message: string }> {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Request body is required');
    }
    const clinicId = this.requireClinicId(req, body.clinicId);
    const data = await this.queueService.updateQueueConfig(body, clinicId);
    return { success: true, data, message: 'Queue config updated' };
  }

  @Patch('capacity')
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.CLINIC_LOCATION_HEAD)
  @ApiOperation({ summary: 'Update queue capacity' })
  async updateQueueCapacity(
    @Body() body: QueueCapacityBody,
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: unknown; message: string }> {
    const capacity = body.capacity;
    if (typeof capacity !== 'number' || !Number.isFinite(capacity) || capacity <= 0) {
      throw new BadRequestException('capacity must be a positive number');
    }
    const clinicId = this.requireClinicId(req, body.clinicId);
    const data = await this.queueService.updateQueueCapacity(body, clinicId);
    return { success: true, data, message: 'Queue capacity updated' };
  }

  @Get('export')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Export queue data' })
  async exportQueueGet(
    @Query() query: QueueExportInput,
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: unknown }> {
    const clinicId = this.requireClinicId(req, query.clinicId);
    const data = await this.queueService.exportQueueData({ ...query, clinicId }, clinicId);
    return { success: true, data };
  }

  @Post('export')
  @Roles(
    Role.DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.CLINIC_LOCATION_HEAD
  )
  @ApiOperation({ summary: 'Export queue data' })
  async exportQueuePost(
    @Body() body: QueueExportInput,
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{ success: true; data: unknown }> {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Request body is required');
    }
    const clinicId = this.requireClinicId(req, body.clinicId);
    const data = await this.queueService.exportQueueData({ ...body, clinicId }, clinicId);
    return { success: true, data };
  }

  private resolveQueueNames(queueName?: string): string[] {
    const names = this.queueService.getQueueNames();
    return queueName && names.includes(queueName) ? [queueName] : names;
  }

  private parseStatuses(status?: string): string[] {
    return status
      ? status
          .split(',')
          .map(v => v.trim().toLowerCase())
          .filter(Boolean)
      : ['waiting', 'active', 'completed', 'failed', 'delayed'];
  }

  private queueNameFromType(_type: string): string {
    // All jobs route through HEALTHCARE_QUEUE — type is used for JobType routing, not physical queue selection
    return HEALTHCARE_QUEUE;
  }

  private toQueueCategory(type: string): string {
    return type
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_');
  }

  private jobPriority(priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'): number {
    if (priority === 'URGENT') return 1;
    if (priority === 'HIGH') return 2;
    if (priority === 'LOW') return 4;
    return 3;
  }

  private priorityWeight(priority?: string): number {
    const p = priority?.toUpperCase();
    if (p === 'URGENT') return 0.5;
    if (p === 'HIGH') return 0.75;
    if (p === 'LOW') return 1.25;
    return 1;
  }

  private matchEntry(entry: QueueEntryLike, query: QueueQuery): boolean {
    const doctorId = this.pick(entry.doctorId, entry.queueOwnerId);
    const locationId = entry.locationId;
    const queueName = entry.queueName;
    const queueType = entry.queueType;
    const queueCategory = entry.queueCategory;
    const status = entry.status?.toLowerCase();
    if (query.doctorId && doctorId !== query.doctorId) return false;
    if (query.locationId && locationId !== query.locationId) return false;
    if (
      query.queueName &&
      query.queueName !== queueName &&
      query.queueName !== queueType &&
      query.queueName !== queueCategory
    )
      return false;
    if (query.type && query.type !== queueType && query.type !== queueCategory) return false;
    if (query.status && !this.parseStatuses(query.status).includes(status || '')) return false;
    return true;
  }

  private operationalEntry(entry: QueueEntryLike, position: number, total: number): QueueEntryLike {
    const appointmentId = this.pick(entry.appointmentId, entry.patientId);
    const patientId = this.pick(entry.patientId, entry.appointmentId);
    const doctorId = this.pick(entry.doctorId);
    const clinicId = this.pick(entry.clinicId);
    const locationId = this.pick(entry.locationId);
    const checkedInAt = this.pick(entry.checkedInAt);
    const startedAt = this.pick(entry.startedAt);
    const completedAt = this.pick(entry.completedAt);
    const notes = this.pick(entry.notes);
    return {
      id: appointmentId,
      appointmentId,
      patientId,
      ...(doctorId ? { doctorId } : {}),
      ...(clinicId ? { clinicId } : {}),
      queueName: HEALTHCARE_QUEUE,
      queueType: this.pick(entry.type, entry.queueCategory, 'DOCTOR_CONSULTATION'),
      queueCategory: this.pick(entry.queueCategory, 'DOCTOR_CONSULTATION'),
      queueOwnerId: this.pick(entry.queueOwnerId, entry.doctorId),
      status: this.pick(entry.status, 'WAITING'),
      position,
      queuePosition: position,
      totalInQueue: total,
      ...(locationId ? { locationId } : {}),
      ...(checkedInAt ? { checkedInAt } : {}),
      ...(startedAt ? { startedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
      ...(notes ? { notes } : {}),
      raw: entry.raw || {},
    };
  }

  private jobEntry(job: Job, position: number, total: number, clinicId: string): QueueEntryLike {
    const data = this.jobData(job);
    const queueType = this.pick(
      this.recordString(data, 'queueType'),
      this.recordString(data, 'type'),
      this.recordString(data, 'queueCategory'),
      job.name
    );
    const appointmentId = this.pick(
      this.recordString(data, 'appointmentId'),
      typeof job.id === 'string' ? job.id : undefined,
      queueType
    );
    const doctorId = this.recordString(data, 'doctorId');
    const locationId = this.recordString(data, 'locationId');
    const checkedInAt = this.recordString(data, 'checkedInAt');
    const startedAt = this.recordString(data, 'startedAt');
    const completedAt = this.recordString(data, 'completedAt');
    const notes = this.recordString(data, 'notes');
    return {
      id: appointmentId,
      entryId: this.pick(this.recordString(data, 'entryId'), appointmentId),
      queueName: this.pick(
        this.asString((job as unknown as Record<string, unknown>)['queueName']),
        queueType
      ),
      queueType,
      queueCategory: this.pick(
        this.recordString(data, 'queueCategory'),
        this.toQueueCategory(queueType)
      ),
      queueOwnerId: this.pick(
        this.recordString(data, 'queueOwnerId'),
        this.recordString(data, 'doctorId'),
        clinicId
      ),
      clinicId: this.pick(this.recordString(data, 'clinicId'), clinicId),
      appointmentId,
      patientId: this.pick(this.recordString(data, 'patientId'), appointmentId),
      ...(doctorId ? { doctorId } : {}),
      status: this.pick(this.recordString(data, 'status'), 'WAITING'),
      position,
      queuePosition: position,
      totalInQueue: total,
      ...(locationId ? { locationId } : {}),
      ...(checkedInAt ? { checkedInAt } : {}),
      ...(startedAt ? { startedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
      ...(notes ? { notes } : {}),
      raw: data,
    };
  }

  private async findJob(
    jobId: string,
    queueName?: string
  ): Promise<{ queueName: string; job: Job } | null> {
    if (queueName) {
      const job = await this.queueService.getJob(queueName, jobId);
      return job ? { queueName, job } : null;
    }
    for (const name of this.queueService.getQueueNames()) {
      const job = await this.queueService.getJob(name, jobId);
      if (job) return { queueName: name, job };
    }
    return null;
  }

  private jobData(job: Job): Record<string, unknown> {
    if (typeof job.data !== 'object' || job.data === null) return {};
    const envelope = job.data as Record<string, unknown>;
    // Unwrap canonical BullMQ envelope: { jobType, action, data: { ... }, metadata }
    // so callers always read from the inner payload regardless of wrapping.
    if (
      typeof envelope['jobType'] === 'string' &&
      typeof envelope['action'] === 'string' &&
      typeof envelope['data'] === 'object' &&
      envelope['data'] !== null
    ) {
      return envelope['data'] as Record<string, unknown>;
    }
    return envelope;
  }

  private safeDate(value: string): string {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${value}`);
    return d.toISOString().split('T')[0] || '';
  }

  private today(): string {
    return new Date().toISOString().split('T')[0] || '';
  }

  private requireClinicId(req: ClinicAuthenticatedRequest, fallback?: string): string {
    const clinicId = req.clinicContext?.clinicId || fallback;
    if (!clinicId) throw new BadRequestException('Clinic ID is required');
    return clinicId;
  }

  private requireString(value: string | undefined, fieldName: string): void {
    if (typeof value !== 'string' || value.trim().length === 0)
      throw new BadRequestException(`${fieldName} is required`);
  }

  private pick(...values: Array<string | undefined>): string {
    const v = values.find(item => typeof item === 'string' && item.trim().length > 0);
    return v?.trim() || '';
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private recordString(data: Record<string, unknown>, key: string): string | undefined {
    return this.asString(data[key]);
  }

  private mergeQueueExportRequest(
    query: QueueExportRequest,
    body: QueueExportRequest
  ): QueueExportRequest {
    const filters: QueueExportRequest = {};
    const queueName = this.pick(body.queueName, query.queueName);
    const queueType = this.pick(body.queueType, query.queueType);
    const type = this.pick(body.type, query.type);
    const clinicId = this.pick(body.clinicId, query.clinicId);
    const startDate = this.pick(body.startDate, query.startDate);
    const endDate = this.pick(body.endDate, query.endDate);
    const status = this.pick(body.status, query.status);
    const format = this.pick(body.format, query.format);
    const limit = this.pick(body.limit, query.limit);

    if (queueName) filters.queueName = queueName;
    if (queueType) filters.queueType = queueType;
    if (type) filters.type = type;
    if (clinicId) filters.clinicId = clinicId;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (status) filters.status = status;
    if (format && ['json', 'csv', 'excel', 'pdf'].includes(format)) {
      filters.format = format as NonNullable<QueueExportRequest['format']>;
    }
    if (limit) filters.limit = limit;

    return filters;
  }

  private async notificationEntry(job: Job): Promise<NotificationQueueLike> {
    const data = this.jobData(job);
    const notificationId = this.pick(
      this.recordString(data, 'notificationId'),
      this.recordString(data, 'id'),
      typeof job.id === 'string' ? job.id : undefined
    );
    const createdAt = this.pick(
      this.recordString(data, 'createdAt'),
      typeof job.timestamp === 'number' ? new Date(job.timestamp).toISOString() : undefined
    );
    const clinicId = this.recordString(data, 'clinicId');
    const readByUserId = this.recordString(data, 'readByUserId');
    const readByRole = this.recordString(data, 'readByRole');
    const updatedAt = this.recordString(data, 'updatedAt');
    const readAt = this.recordString(data, 'readAt');
    const audienceRoles = this.notificationAudienceRoles(data);
    const jobStateValue = typeof job.getState === 'function' ? await job.getState() : undefined;
    const jobState = this.asString(jobStateValue);
    const notificationType = this.pick(
      this.recordString(data, 'type'),
      this.recordString(data, 'category'),
      'SYSTEM'
    );

    return {
      id: notificationId,
      notificationId,
      userId: this.pick(this.recordString(data, 'userId'), this.recordString(data, 'recipientId')),
      title: this.pick(this.recordString(data, 'title'), this.recordString(data, 'subject')),
      message: this.pick(this.recordString(data, 'message'), this.recordString(data, 'body')),
      type: notificationType,
      status: this.pick(this.recordString(data, 'status'), readAt ? 'READ' : 'QUEUED'),
      queueName: HEALTHCARE_QUEUE,
      raw: data,
      ...(clinicId ? { clinicId } : {}),
      ...(readAt ? { readAt } : {}),
      ...(readByUserId ? { readByUserId } : {}),
      ...(readByRole ? { readByRole } : {}),
      ...(audienceRoles.length > 0 ? { audienceRoles } : {}),
      ...(jobState ? { jobState } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    };
  }

  private matchesNotification(
    notification: NotificationQueueLike,
    query: NotificationQueueQuery,
    clinicId: string,
    status: 'all' | 'read' | 'unread',
    req: ClinicAuthenticatedRequest
  ): boolean {
    if (!this.canAccessNotification(notification, req, clinicId)) return false;
    if (query.clinicId && notification.clinicId !== query.clinicId) return false;
    if (query.userId && notification.userId !== query.userId) return false;

    const isRead =
      notification.status?.toUpperCase() === 'READ' || typeof notification.readAt === 'string';
    if (status === 'read' && !isRead) return false;
    if (status === 'unread' && isRead) return false;
    return true;
  }

  private canAccessNotification(
    notification: NotificationQueueLike,
    req: ClinicAuthenticatedRequest,
    clinicId: string
  ): boolean {
    const role = req.user?.role as Role | undefined;
    const userId = this.currentUserId(req);

    if (role === Role.SUPER_ADMIN) {
      return true;
    }

    if (notification.clinicId && notification.clinicId !== clinicId) {
      return false;
    }

    if (role === Role.CLINIC_ADMIN) {
      return true;
    }

    if (notification.userId && notification.userId !== userId) {
      return false;
    }

    if (notification.audienceRoles && notification.audienceRoles.length > 0 && role) {
      return notification.audienceRoles.includes(role);
    }

    return true;
  }

  private currentUserId(req: ClinicAuthenticatedRequest): string {
    return this.pick(req.user?.id, req.user?.sub);
  }

  private currentUserRole(req: ClinicAuthenticatedRequest): string {
    return this.asString(req.user?.role) || 'UNKNOWN';
  }

  private parseNotificationStatus(status?: string): 'all' | 'read' | 'unread' {
    const normalized = status?.trim().toLowerCase();
    if (!normalized || normalized === 'all') return 'all';
    if (normalized === 'read' || normalized === 'unread') return normalized;
    throw new BadRequestException('status must be one of: all, read, unread');
  }

  private parseLimit(limit?: string, defaultValue = 100): number {
    if (!limit) return defaultValue;
    const parsed = Number(limit);
    if (!Number.isInteger(parsed) || parsed < 1)
      throw new BadRequestException('limit must be a positive integer');
    return parsed;
  }

  private normalizeRoles(roles?: string[]): string[] | undefined {
    if (!Array.isArray(roles) || roles.length === 0) return undefined;
    const normalized = roles.map(role => role.trim().toUpperCase()).filter(Boolean);
    return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
  }

  private normalizeMetadata(
    metadata?: Record<string, unknown>
  ): Record<string, unknown> | undefined {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
    return metadata;
  }

  private notificationAudienceRoles(data: Record<string, unknown>): string[] {
    const rawRoles = data['audienceRoles'];
    if (Array.isArray(rawRoles)) {
      return rawRoles
        .filter((role): role is string => typeof role === 'string' && role.trim().length > 0)
        .map(role => role.trim().toUpperCase());
    }

    const roles = [
      this.recordString(data, 'audienceRole'),
      this.recordString(data, 'targetRole'),
      this.recordString(data, 'recipientRole'),
      this.recordString(data, 'role'),
    ].filter((role): role is string => typeof role === 'string' && role.trim().length > 0);

    return Array.from(new Set(roles.map(role => role.trim().toUpperCase())));
  }

  private async safeContext(
    appointmentId: string,
    clinicId: string,
    domain: 'clinic'
  ): Promise<{ doctorId: string } | null> {
    try {
      const ctx = await this.appointmentQueueService.getPatientQueuePosition(
        appointmentId,
        clinicId,
        domain
      );
      return ctx.doctorId ? { doctorId: ctx.doctorId } : null;
    } catch {
      return null;
    }
  }
}
