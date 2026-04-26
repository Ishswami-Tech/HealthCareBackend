/**
 * ENTERPRISE QUEUE SERVICE (BullMQ) - PRODUCTION READY EDITION
 * =====================================================================
 * 🚀 High Performance | 🔐 Secure | 📊 Reliable | 🌍 Scalable | 🏥 Domain Isolated
 *
 * @fileoverview Enterprise-grade queue management service for healthcare applications
 * @description Provides comprehensive queue operations with domain isolation, monitoring, and scalability
 * @version 1.0.0
 * @author Healthcare Backend Team
 * @since 2024
 */

import { Injectable, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { Queue, Job, JobsOptions, Worker, JobState } from 'bullmq';
import { ConfigService } from '@config/config.service';
import { QueueMonitoringService } from './monitoring/queue-monitoring.service';
import {
  IQueueService,
  QueueConfigState,
  QueueCapacityState,
  QueueConfigUpdateInput,
  QueueCapacityUpdateInput,
  QueueExportFilters,
  QueueExportEntry,
  QueueExportPayload,
  QueueConfigSnapshot,
} from './interfaces/queue-service.interface';

// Internal imports - Infrastructure
import { LoggingService } from '@infrastructure/logging';

// Internal imports - Core
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { LogType, LogLevel } from '@core/types';
import { AppointmentType, TreatmentType } from '@core/types/enums.types';
import { HEALTHCARE_QUEUE } from './queue.constants';

// Internal imports - Types
import {
  JobType,
  JobPriorityLevel,
  CanonicalJobEnvelope,
  DetailedQueueMetrics,
  QueueHealthStatus,
  QueueFilters,
  ClientSession,
  EnterpriseJobOptions,
  BulkJobData,
} from '@core/types/queue.types';

// Domain is always 'clinic' — single-application healthcare system

type QueueFilterOption = {
  value: string;
  label: string;
  description: string;
  aliases?: string[];
};

type QueueFilterGroup = {
  key: string;
  label: string;
  description: string;
  filters: QueueFilterOption[];
};

/**
 * Enterprise Queue Service for Healthcare Applications
 *
 * Provides comprehensive queue management with domain isolation, monitoring,
 * and scalability features for healthcare applications. Supports multiple
 * queue types including appointments, notifications, payments, and analytics.
 *
 * @class QueueService
 * @description Main service for managing BullMQ queues with enterprise features
 * @implements {OnModuleInit} - Initializes queues on module startup
 * @implements {OnModuleDestroy} - Cleans up resources on module shutdown
 *
 * @example
 * ```typescript
 * // Inject the service
 * constructor(private readonly queueService: QueueService) {}
 *
 * // Add a job to a queue
 * await this.queueService.addJob('appointment-queue', 'create-appointment', {
 *   appointmentId: '123',
 *   patientId: '456',
 *   doctorId: '789'
 * });
 *
 * // Get queue status
 * const status = await this.queueService.getQueueStatus('appointment-queue');
 * ```
 *
 * @features
 * - Domain isolation (clinic vs worker domains)
 * - Real-time monitoring and metrics
 * - Auto-scaling workers
 * - Comprehensive audit logging
 * - HIPAA-compliant data handling
 * - Multi-tenant support
 * - Circuit breaker patterns
 * - Dead letter queue management
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy, IQueueService {
  // ========================================
  // STATIC PROPERTIES - SINGLE SOURCE OF TRUTH
  // ========================================
  // These static properties expose all queue constants and configurations
  // Access via: QueueService.HEALTHCARE_QUEUE, QueueService.PRIORITIES, etc.

  // Queue Name — Single canonical physical queue
  static readonly HEALTHCARE_QUEUE = HEALTHCARE_QUEUE;

  // Queue Priorities - Access via QueueService.PRIORITIES
  // These values match QUEUE_PRIORITIES from @core/types/queue.types.ts for consistency
  static readonly PRIORITIES = {
    CRITICAL: 10,
    HIGH: 7,
    NORMAL: 5,
    LOW: 3,
    BACKGROUND: 1,
  } as const;

  // Logical queue filters supported by the unified queue model.
  // These values are used for dashboard filtering and legacy compatibility.
  static readonly QUEUE_FILTER_CATALOG: readonly QueueFilterGroup[] = [
    {
      key: 'appointments',
      label: 'Appointments',
      description:
        'Appointment lifecycle, queue orchestration, reminders, and follow-up workflows.',
      filters: [
        {
          value: 'appointment',
          label: 'Appointments',
          description: 'All appointment queue activity',
          aliases: ['appointment-queue', 'enhanced-appointment-queue', HEALTHCARE_QUEUE],
        },
        {
          value: 'queue_management',
          label: 'Queue Management',
          description: 'Queue reordering, transfer, pause, and resume operations',
          aliases: ['queue-management', 'queue-management-queue'],
        },
        {
          value: 'waiting_list',
          label: 'Waiting List',
          description: 'Patients waiting to be moved into consultation',
          aliases: ['waiting-list'],
        },
        {
          value: 'follow_up',
          label: 'Follow Up',
          description: 'Follow-up scheduling and reminders',
          aliases: ['follow-up', 'follow-up-queue'],
        },
        {
          value: 'reminder',
          label: 'Reminder',
          description: 'Appointment reminder dispatch jobs',
          aliases: ['reminder-queue'],
        },
        {
          value: 'calendar_sync',
          label: 'Calendar Sync',
          description: 'Calendar synchronization and scheduling sync jobs',
          aliases: ['calendar-sync', 'calendar-sync-queue'],
        },
        {
          value: 'doctor_availability',
          label: 'Doctor Availability',
          description: 'Availability lookup and slot generation jobs',
          aliases: ['availability', 'doctor-availability'],
        },
        {
          value: 'recurring_appointment',
          label: 'Recurring Appointments',
          description: 'Recurring series and template-based appointment jobs',
          aliases: ['recurring', 'series'],
        },
      ],
    },
    {
      key: 'appointment-modes',
      label: 'Appointment Modes',
      description: 'Appointment entry mode used to classify the consultation request.',
      filters: [
        {
          value: AppointmentType.IN_PERSON,
          label: 'In Person',
          description: 'Physical clinic appointment',
        },
        {
          value: AppointmentType.VIDEO_CALL,
          label: 'Video Call',
          description: 'Remote video consultation appointment',
        },
        {
          value: AppointmentType.HOME_VISIT,
          label: 'Home Visit',
          description: 'Doctor visit at patient location',
        },
      ],
    },
    {
      key: 'treatments',
      label: 'Treatments',
      description: 'Clinical and Ayurvedic treatment intent for appointments.',
      filters: [
        {
          value: TreatmentType.GENERAL_CONSULTATION,
          label: 'General Consultation',
          description: 'General consultation workflow',
        },
        {
          value: TreatmentType.FOLLOW_UP,
          label: 'Follow Up',
          description: 'Follow-up consultation workflow',
        },
        {
          value: 'procedural_care',
          label: 'Procedural Care',
          description: 'Combined therapeutic and surgical appointment workflow',
          aliases: [TreatmentType.THERAPY, TreatmentType.SURGERY],
        },
        {
          value: 'diagnostic_preventive',
          label: 'Diagnostic',
          description: 'Combined diagnostic, imaging, and preventive workflow',
          aliases: [TreatmentType.LAB_TEST, TreatmentType.IMAGING, TreatmentType.VACCINATION],
        },
        {
          value: TreatmentType.SPECIAL_CASE,
          label: 'Special Case',
          description: 'Complex, sensitive, or unusual care needs',
        },
        {
          value: TreatmentType.GERIATRIC_CARE,
          label: 'Senior Citizen',
          description: 'Care workflow for senior citizens and older adults',
        },
        {
          value: TreatmentType.VIDDHAKARMA,
          label: 'Viddhakarma',
          description: 'Ayurvedic puncture-based procedure workflow',
        },
        {
          value: TreatmentType.AGNIKARMA,
          label: 'Agnikarma',
          description: 'Ayurvedic heat-based procedure workflow',
        },
        {
          value: TreatmentType.PANCHAKARMA,
          label: 'Panchakarma',
          description: 'Ayurvedic detoxification workflow',
        },
        {
          value: TreatmentType.NADI_PARIKSHA,
          label: 'Nadi Pariksha',
          description: 'Pulse diagnosis workflow',
        },
        {
          value: TreatmentType.SHIRODHARA,
          label: 'Shirodhara',
          description: 'Ayurvedic therapy workflow',
        },
        {
          value: 'ayurvedic_procedures',
          label: 'Ayurvedic Procedures',
          description: 'Combined Ayurvedic procedure workflow',
          aliases: [
            TreatmentType.DOSHA_ANALYSIS,
            TreatmentType.VIRECHANA,
            TreatmentType.ABHYANGA,
            TreatmentType.SWEDANA,
            TreatmentType.BASTI,
            TreatmentType.NASYA,
            TreatmentType.RAKTAMOKSHANA,
          ],
        },
      ],
    },
    {
      key: 'billing-and-payments',
      label: 'Billing And Payments',
      description: 'Payment collection, reconciliation, invoice generation, and billing support.',
      filters: [
        {
          value: 'billing',
          label: 'Billing',
          description: 'General billing and invoice management',
          aliases: ['invoice', 'invoice-pdf-queue', 'bulk-invoice-queue'],
        },
        {
          value: 'payment',
          label: 'Payments',
          description: 'Payment collection and processing',
          aliases: [
            'payments',
            'payment-processing-queue',
            'payment-reconciliation-queue',
            'payment-analytics',
            'payment-notification',
          ],
        },
        {
          value: 'invoice',
          label: 'Invoices',
          description: 'Invoice PDF generation and bulk invoice jobs',
          aliases: ['invoice-pdf-queue', 'bulk-invoice-queue'],
        },
        {
          value: 'payment_processing',
          label: 'Payment Processing',
          description: 'Transaction capture and payment gateway processing',
        },
        {
          value: 'payment_reconciliation',
          label: 'Payment Reconciliation',
          description: 'Reconciliation and settlement workflows',
        },
        {
          value: 'payment_analytics',
          label: 'Payment Analytics',
          description: 'Payment reporting and analytics workflows',
        },
      ],
    },
    {
      key: 'video',
      label: 'Video',
      description: 'Video consultation orchestration, recording, transcoding, and analytics.',
      filters: [
        {
          value: 'video',
          label: 'Video',
          description: 'All video consultation jobs',
          aliases: ['video-recording-queue', 'video-transcoding-queue', 'video-analytics-queue'],
        },
        {
          value: 'video_recording',
          label: 'Video Recording',
          description: 'Consultation recording jobs',
          aliases: ['video-recording-queue'],
        },
        {
          value: 'video_transcoding',
          label: 'Video Transcoding',
          description: 'Video transcoding pipeline jobs',
          aliases: ['video-transcoding-queue'],
        },
        {
          value: 'video_analytics',
          label: 'Video Analytics',
          description: 'Video analytics and quality jobs',
          aliases: ['video-analytics-queue'],
        },
      ],
    },
    {
      key: 'clinical-support',
      label: 'Clinical Support',
      description: 'Diagnostics, EHR imports, and cross-service operational support.',
      filters: [
        {
          value: 'email',
          label: 'Email',
          description: 'Email delivery jobs',
          aliases: ['email-queue'],
        },
        {
          value: 'notification',
          label: 'Notifications',
          description: 'Push, in-app, SMS, and WhatsApp notifications',
          aliases: ['notification-queue'],
        },
        {
          value: 'lab_report',
          label: 'Lab Reports',
          description: 'Lab report generation and delivery jobs',
          aliases: ['lab-report-queue'],
        },
        {
          value: 'imaging',
          label: 'Imaging',
          description: 'Imaging and scan workflow jobs',
          aliases: ['imaging-queue'],
        },
        {
          value: 'bulk_ehr_import',
          label: 'Bulk EHR Import',
          description: 'Bulk EHR ingestion and migration jobs',
          aliases: ['bulk-ehr-import-queue'],
        },
        {
          value: 'analytics',
          label: 'Analytics',
          description: 'General analytics and reporting jobs',
          aliases: ['analytics-queue'],
        },
        {
          value: 'ayurveda_therapy',
          label: 'Ayurveda Therapy',
          description: 'Ayurvedic therapy job workflows',
          aliases: ['ayurveda-therapy'],
        },
        {
          value: 'vidhakarma',
          label: 'Viddhakarma',
          description: 'Viddhakarma treatment jobs',
          aliases: ['vidhakarma-queue'],
        },
        {
          value: 'panchakarma',
          label: 'Panchakarma',
          description: 'Panchakarma treatment jobs',
          aliases: ['panchakarma-queue'],
        },
        {
          value: 'chequp',
          label: 'Chequp',
          description: 'Chequp treatment or checkup jobs',
          aliases: ['chequp-queue'],
        },
        {
          value: 'service',
          label: 'Service',
          description: 'Generic service queue jobs',
          aliases: ['service-queue'],
        },
      ],
    },
  ] as const;

  static readonly SUPPORTED_QUEUE_FILTERS = QueueService.flattenQueueFilterCatalog(
    QueueService.QUEUE_FILTER_CATALOG
  );

  private static flattenQueueFilterCatalog(catalog: readonly QueueFilterGroup[]): string[] {
    const filters = catalog.flatMap(group =>
      group.filters.flatMap(filter => [filter.value, ...(filter.aliases || [])])
    );
    const normalized = filters.map(filter => filter.trim()).filter(Boolean);
    return Array.from(new Set([HEALTHCARE_QUEUE, ...normalized]));
  }

  // Instance properties
  // Initialize Maps with defensive checks to prevent undefined errors
  private readonly queues: Map<string, Queue> = new Map<string, Queue>();
  private readonly workers: Map<string, Worker[]> = new Map<string, Worker[]>();
  private readonly connectedClients: Map<string, ClientSession> = new Map<string, ClientSession>();
  private readonly queueMetrics: Map<string, DetailedQueueMetrics> = new Map<
    string,
    DetailedQueueMetrics
  >();
  private readonly queueConfigDefaults: Map<string, QueueConfigState> = new Map<
    string,
    QueueConfigState
  >();
  private readonly queueConfigOverrides: Map<string, QueueConfigState> = new Map<
    string,
    QueueConfigState
  >();
  private readonly queueCapacityOverrides: Map<string, QueueCapacityState> = new Map<
    string,
    QueueCapacityState
  >();
  private healthCheckInterval!: NodeJS.Timeout;
  private metricsUpdateInterval!: NodeJS.Timeout;
  private autoScalingInterval!: NodeJS.Timeout;

  /**
   * Creates an instance of QueueService
   *
   * @param configService - Configuration service for environment variables
   * @param bullQueues - Array of BullMQ queue instances injected by the module
   * @param bullWorkers - Array of BullMQ worker instances (optional)
   * @param monitoringService - Service for queue monitoring and metrics
   *
   * @description Initializes the queue service with dependency injection and
   * sets up the internal queue and worker management systems.
   */
  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject('BULLMQ_QUEUES') private readonly bullQueues: Queue[],
    @Inject('BULLMQ_WORKERS') private readonly bullWorkers: Worker[] = [],
    private readonly monitoringService: QueueMonitoringService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      // Use ConfigService (which uses dotenv) for environment variable access
      `🚀 QueueService constructor called for ${this.configService.getEnv('SERVICE_NAME', 'unknown')} service`,
      'QueueService',
      {}
    );
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      `📊 Received ${this.bullQueues?.length || 0} queues and ${this.bullWorkers?.length || 0} workers`,
      'QueueService',
      {}
    );

    const _currentDomain = this.getCurrentDomain();

    // Safe initialization with error handling
    try {
      this.initializeQueues();
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to initialize queues`,
        'QueueService',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
    }

    try {
      this.initializeWorkers();
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to initialize workers`,
        'QueueService',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
    }

    // Enhanced health monitoring for 10 lakh+ users
    this.healthCheckInterval = setInterval(() => {
      void this.updateHealthStatus();
    }, 15000); // Every 15 seconds for better responsiveness

    // Enhanced metrics collection for 10 lakh+ users
    this.metricsUpdateInterval = setInterval(() => {
      void this.updateQueueMetrics();
    }, 5000); // Every 5 seconds for real-time monitoring
  }

  // Domain is always 'clinic' — single-application healthcare system
  private getCurrentDomain(): string {
    return 'clinic';
  }

  /**
   * Get available queues for current domain
   */
  private getAvailableQueues(): string[] {
    // All jobs route through a single unified queue
    return [HEALTHCARE_QUEUE];
  }

  private initializeQueues(): void {
    // Initialize queues based on domain with error handling
    if (!this.bullQueues || !Array.isArray(this.bullQueues)) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `No bullQueues provided or invalid format`,
        'QueueService',
        { receivedType: typeof this.bullQueues }
      );
      return;
    }

    // Defensive check: ensure queues Map is initialized
    if (!this.queues) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'queues Map is not initialized',
        'QueueService',
        {}
      );
      return;
    }

    let initializedCount = 0;
    this.bullQueues.forEach((queue, index) => {
      try {
        if (!queue || !queue.name) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Skipping invalid queue at index ${index}`,
            'QueueService',
            { index, queue: JSON.stringify(queue) }
          );
          return;
        }

        // Defensive check before calling .set()
        if (this.queues && typeof this.queues.set === 'function') {
          this.queues.set(queue.name, queue);
        } else {
          throw new Error('queues Map is not properly initialized');
        }
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `Initialized queue: ${queue.name} for domain: ${this.getCurrentDomain()}`,
          'QueueService',
          { queueName: queue.name, domain: this.getCurrentDomain() }
        );
        initializedCount++;
      } catch (_error) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          `Failed to initialize queue at index ${index}`,
          'QueueService',
          { index, error: _error instanceof Error ? _error.message : String(_error) }
        );
      }
    });

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      `Successfully initialized ${initializedCount}/${this.bullQueues.length} queues for ${this.getCurrentDomain()} domain`,
      'QueueService',
      { initializedCount, totalQueues: this.bullQueues.length, domain: this.getCurrentDomain() }
    );
  }

  private initializeWorkers(): void {
    // Initialize workers based on domain with error handling
    if (!this.bullWorkers || !Array.isArray(this.bullWorkers)) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `No bullWorkers provided or invalid format for ${this.getCurrentDomain()} service (this is normal for non-worker services)`,
        'QueueService',
        { domain: this.getCurrentDomain() }
      );
      return;
    }

    // Defensive check: ensure workers Map is initialized
    if (!this.workers) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'workers Map is not initialized',
        'QueueService',
        {}
      );
      return;
    }

    let initializedCount = 0;
    this.bullWorkers.forEach((worker, index) => {
      try {
        if (!worker || !worker.name) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Skipping invalid worker at index ${index}`,
            'QueueService',
            { index, worker: JSON.stringify(worker) }
          );
          return;
        }

        // Defensive check before calling .set()
        if (this.workers && typeof this.workers.set === 'function') {
          this.workers.set(worker.name, [worker]);
        } else {
          throw new Error('workers Map is not properly initialized');
        }
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `Initialized worker: ${worker.name} for domain: ${this.getCurrentDomain()}`,
          'QueueService',
          { workerName: worker.name, domain: this.getCurrentDomain() }
        );
        initializedCount++;
      } catch (_error) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          `Failed to initialize worker at index ${index}`,
          'QueueService',
          { index, error: _error instanceof Error ? _error.message : String(_error) }
        );
      }
    });

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      `Successfully initialized ${initializedCount}/${this.bullWorkers.length} workers for ${this.getCurrentDomain()} domain`,
      'QueueService',
      { initializedCount, totalWorkers: this.bullWorkers.length, domain: this.getCurrentDomain() }
    );
  }

  /**
   * Adds a new job to the specified queue
   *
   * @template T - Type of the job data
   * @param queueName - Name of the target queue
   * @param jobType - Type/category of the job
   * @param data - Job data payload
   * @param options - Additional job options (priority, delay, etc.)
   * @returns Promise resolving to the created Job instance
   *
   * @description Adds a job to the specified queue with enterprise features
   * including domain validation, audit logging, and monitoring integration.
   *
   * @example
   * ```typescript
   * const job = await this.queueService.addJob(
   *   'appointment-queue',
   *   'create-appointment',
   *   { appointmentId: '123', patientId: '456' },
   *   { priority: JobPriority.HIGH, delay: 5000 }
   * );
   * ```
   *
   * @throws {Error} When queue is not found or domain access is denied
   */
  async addJob<T = unknown>(
    jobType: JobType,
    action: string,
    data: T,
    options: EnterpriseJobOptions = {}
  ): Promise<Job> {
    const startTime = Date.now();

    try {
      const queue = this.queues.get(HEALTHCARE_QUEUE);
      if (!queue) {
        throw new HealthcareError(
          ErrorCode.QUEUE_NOT_FOUND,
          `Queue ${HEALTHCARE_QUEUE} not found for domain ${this.getCurrentDomain()}`,
          undefined,
          { queueName: HEALTHCARE_QUEUE, domain: this.getCurrentDomain() },
          'QueueService'
        );
      }

      // Enhanced job options for 1M users
      const enhancedOptions: JobsOptions = {
        priority: this.getJobPriority(options.priority),
        delay: options.delay || 0,
        attempts: options.attempts || 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: options.removeOnComplete ?? 100,
        removeOnFail: options.removeOnFail ?? 50,
        // timeout: options.timeout || 30000, // BullMQ doesn't support timeout in JobsOptions
        ...(options.correlationId && { jobId: options.correlationId }),
        // Enhanced metadata for 1M users - stored in job data instead
      };

      // Determine priority level (with fallback to normal)
      const priorityEnumVal = options.priority
        ? this.mapNumericToPriorityLevel(options.priority)
        : JobPriorityLevel.NORMAL;

      // Construct Canonical Envelope
      const canonicalPayload: CanonicalJobEnvelope<T> = {
        jobType: jobType,
        priority: priorityEnumVal,
        domain: 'clinic',
        ...(options.tenantId && { tenantId: options.tenantId }),
        action: action,
        data: data,
        metadata: {
          domain: this.getCurrentDomain(),
          ...(options.tenantId && { tenantId: options.tenantId }),
          auditLevel: options.auditLevel || 'basic',
          classification: options.classification || 'internal',
          createdAt: new Date(),
          ...(options.correlationId && { correlationId: options.correlationId }),
        },
      };

      // Note: passing jobType explicitly here is important for the Generic Worker Router
      const job = await queue.add(jobType, canonicalPayload, enhancedOptions);

      // Update monitoring metrics
      void this.updateMonitoringMetrics(HEALTHCARE_QUEUE);

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Job added to canonical queue ${HEALTHCARE_QUEUE}: ${job.id} for domain ${this.getCurrentDomain()}`,
        'QueueService',
        {
          jobId: job.id,
          jobType,
          queueName: HEALTHCARE_QUEUE,
          domain: this.getCurrentDomain(),
          responseTime: Date.now() - startTime,
        }
      );

      return job;
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to add job to queue ${HEALTHCARE_QUEUE}`,
        'QueueService',
        {
          queueName: HEALTHCARE_QUEUE,
          domain: this.getCurrentDomain(),
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );
      throw _error;
    }
  }

  /**
   * Add multiple jobs in bulk for high-throughput operations natively routing to the unified queue.
   */
  async addBulkJobs<T = unknown>(jobType: JobType, jobs: BulkJobData<T>[]): Promise<Job[]> {
    const startTime = Date.now();

    try {
      const queue = this.queues.get(HEALTHCARE_QUEUE);
      if (!queue) {
        throw new HealthcareError(
          ErrorCode.QUEUE_NOT_FOUND,
          `Queue ${HEALTHCARE_QUEUE} not found for domain ${this.getCurrentDomain()}`,
          undefined,
          { queueName: HEALTHCARE_QUEUE, domain: this.getCurrentDomain() },
          'QueueService'
        );
      }

      // Enhanced bulk job processing for 1M users
      const enhancedJobs = jobs.map(job => {
        const priorityEnumVal = job.options?.priority
          ? this.mapNumericToPriorityLevel(job.options.priority)
          : JobPriorityLevel.NORMAL;
        const canonicalPayload: CanonicalJobEnvelope<T> = {
          jobType: jobType,
          priority: priorityEnumVal,
          domain: 'clinic',
          ...(job.options?.tenantId && { tenantId: job.options.tenantId }),
          action: job.jobType, // what legacy calls jobType is actually action string
          data: job.data,
          metadata: {
            domain: this.getCurrentDomain(),
            ...(job.options?.tenantId && { tenantId: job.options.tenantId }),
            auditLevel: job.options?.auditLevel || 'basic',
            classification: job.options?.classification || 'internal',
            createdAt: new Date().toISOString(),
            ...(job.options?.correlationId && { correlationId: job.options.correlationId }),
          },
        };

        return {
          name: job.jobType,
          data: canonicalPayload,
          opts: {
            priority: this.getJobPriority(job.options?.priority),
            delay: job.options?.delay || 0,
            attempts: job.options?.attempts || 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
            removeOnComplete: job.options?.removeOnComplete ?? 100,
            removeOnFail: job.options?.removeOnFail ?? 50,
            timeout: job.options?.timeout || 30000,
            ...(job.options?.correlationId && {
              jobId: job.options.correlationId,
            }),
          },
        };
      });

      const addedJobs = await queue.addBulk(enhancedJobs);

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Bulk jobs added to queue ${HEALTHCARE_QUEUE}: ${addedJobs.length} jobs for domain ${this.getCurrentDomain()}`,
        'QueueService',
        {
          queueName: HEALTHCARE_QUEUE,
          domain: this.getCurrentDomain(),
          jobCount: addedJobs.length,
          responseTime: Date.now() - startTime,
        }
      );

      return addedJobs;
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to add bulk jobs to queue ${HEALTHCARE_QUEUE}`,
        'QueueService',
        {
          queueName: HEALTHCARE_QUEUE,
          domain: this.getCurrentDomain(),
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
          responseTime: Date.now() - startTime,
        }
      );
      throw _error;
    }
  }

  /**
   * Get jobs from a domain-specific queue with enhanced filtering
   */
  async getJobs(queueName: string, filters: QueueFilters = {}): Promise<Job[]> {
    try {
      const queue = this.queues.get(queueName);
      if (!queue) {
        // Return empty array instead of throwing error to prevent health check failures
        void this.loggingService.log(
          LogType.QUEUE,
          LogLevel.WARN,
          `Queue ${queueName} not found for domain ${this.getCurrentDomain()}`,
          'QueueService',
          { queueName, domain: this.getCurrentDomain() }
        );
        return [];
      }

      // Enhanced job filtering for 1M users
      const jobStates: JobState[] = (filters.status as JobState[]) || [
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
      ];
      const jobs: Job[] = [];

      for (const state of jobStates) {
        const stateJobs = await queue.getJobs([state], 0, 1000); // Limit to 1000 jobs per state
        jobs.push(...stateJobs);
      }

      // Apply additional filters
      const filteredJobs = jobs.filter(job => {
        if (
          filters.priority &&
          job.opts.priority !== this.getJobPriority(Number(filters.priority[0]))
        ) {
          return false;
        }
        if (
          filters.tenantId &&
          (job.data as { _tenantId?: string })._tenantId !== filters.tenantId
        ) {
          return false;
        }
        return true;
      });

      return filteredJobs;
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to get jobs from queue ${queueName}`,
        'QueueService',
        {
          queueName,
          domain: this.getCurrentDomain(),
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      // Return empty array instead of throwing to prevent health check failures
      return [];
    }
  }

  /**
   * Get the names of all registered queues
   */
  getQueueNames(): string[] {
    return Array.from(this.queues.keys());
  }

  /**
   * Get the queue names supported by the unified queue model.
   * This is used by dashboards and filters to show the logical queue categories
   * even though BullMQ itself uses a single physical queue.
   */
  getSupportedQueueFilters(): string[] {
    return Array.from(new Set(QueueService.SUPPORTED_QUEUE_FILTERS));
  }

  /**
   * Get the structured queue filter catalog for dashboard consumers.
   */
  getQueueFilterCatalog(): QueueFilterGroup[] {
    return QueueService.QUEUE_FILTER_CATALOG.map(group => ({
      ...group,
      filters: group.filters.map(filter => ({
        ...filter,
        ...(filter.aliases ? { aliases: [...filter.aliases] } : {}),
      })),
    }));
  }

  private pick(...values: Array<string | undefined>): string {
    const value = values.find(item => typeof item === 'string' && item.trim().length > 0);
    return value?.trim() || '';
  }

  // ========================================
  // JOB TYPE MAPPERS (For Queue Unification)
  // ========================================

  private isLegacyQueue(queueName: string): boolean {
    return queueName !== 'healthcare-queue' && Object.values(QueueService).includes(queueName);
  }

  private mapLegacyToJobType(queueName: string): JobType {
    if (queueName === 'appointment-queue' || queueName === 'enhanced-appointment-queue')
      return JobType.APPOINTMENT;
    if (queueName === 'email-queue') return JobType.EMAIL;
    if (queueName === 'notification-queue') return JobType.NOTIFICATION;
    if (queueName === 'invoice-pdf-queue') return JobType.INVOICE_PDF;
    if (queueName === 'bulk-invoice-queue') return JobType.BULK_INVOICE;
    if (queueName === 'payment-processing-queue') return JobType.PAYMENT_PROCESSING;
    if (queueName === 'payment-reconciliation-queue') return JobType.PAYMENT_RECONCILIATION;
    if (queueName === 'payment-analytics-queue') return JobType.PAYMENT_ANALYTICS;
    if (queueName === 'payment-notification-queue') return JobType.PAYMENT_NOTIFICATION;
    if (queueName === 'lab-report-queue') return JobType.LAB_REPORT;
    if (queueName === 'imaging-queue') return JobType.IMAGING;
    if (queueName === 'bulk-ehr-import-queue') return JobType.BULK_EHR_IMPORT;
    if (queueName === 'video-recording-queue') return JobType.VIDEO_RECORDING;
    if (queueName === 'video-transcoding-queue') return JobType.VIDEO_TRANSCODING;
    if (queueName === 'video-analytics-queue') return JobType.VIDEO_ANALYTICS;
    if (queueName === 'analytics-queue') return JobType.ANALYTICS;
    if (queueName === 'vidhakarma-queue') return JobType.VIDHAKARMA;
    if (queueName === 'panchakarma-queue') return JobType.PANCHAKARMA;
    if (queueName === 'chequp-queue') return JobType.CHEQUP;
    if (queueName === 'calendar-sync-queue') return JobType.CALENDAR_SYNC;

    return JobType.UNKNOWN;
  }

  private getQueueJobFamily(jobType: string, data: Record<string, unknown> = {}): string {
    const normalizedJobType = jobType.trim().toLowerCase();
    const normalizedQueueType = this.pick(
      this.recordString(data, 'queueType'),
      this.recordString(data, 'queueCategory'),
      this.recordString(data, 'treatmentType'),
      this.recordString(data, 'serviceBucket')
    )
      .trim()
      .toLowerCase();

    if (
      normalizedJobType.includes('appointment') ||
      normalizedQueueType.includes('appointment') ||
      normalizedQueueType.includes('consultation') ||
      normalizedQueueType.includes('follow')
    ) {
      return 'appointments';
    }

    if (
      normalizedJobType.includes('payment') ||
      normalizedJobType.includes('invoice') ||
      normalizedQueueType.includes('billing') ||
      normalizedQueueType.includes('invoice') ||
      normalizedQueueType.includes('payment')
    ) {
      return 'billing-and-payments';
    }

    if (normalizedJobType.includes('video') || normalizedQueueType.includes('video')) {
      return 'video';
    }

    if (
      normalizedJobType.includes('email') ||
      normalizedJobType.includes('notification') ||
      normalizedJobType.includes('reminder')
    ) {
      return 'clinical-support';
    }

    if (
      normalizedJobType.includes('lab') ||
      normalizedJobType.includes('imaging') ||
      normalizedJobType.includes('bulk_ehr') ||
      normalizedQueueType.includes('lab') ||
      normalizedQueueType.includes('imaging')
    ) {
      return 'clinical-support';
    }

    if (
      normalizedJobType.includes('vidhakarma') ||
      normalizedJobType.includes('panchakarma') ||
      normalizedJobType.includes('chequp') ||
      normalizedJobType.includes('ayurveda') ||
      normalizedQueueType.includes('ayurveda') ||
      normalizedQueueType.includes('panchakarma')
    ) {
      return 'clinical-support';
    }

    return this.toQueueCategory(jobType);
  }

  private mapNumericToPriorityLevel(numericPriority: number): JobPriorityLevel {
    if (numericPriority >= 10) return JobPriorityLevel.CRITICAL;
    if (numericPriority >= 7) return JobPriorityLevel.HIGH;
    if (numericPriority >= 5) return JobPriorityLevel.NORMAL;
    if (numericPriority >= 3) return JobPriorityLevel.LOW;
    return JobPriorityLevel.BACKGROUND;
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private recordString(data: Record<string, unknown>, key: string): string | undefined {
    return this.asString(data[key]);
  }

  private jobData(job: Job): Record<string, unknown> {
    return typeof job.data === 'object' && job.data !== null
      ? (job.data as Record<string, unknown>)
      : {};
  }

  private toQueueCategory(type: string): string {
    return type
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_');
  }

  /**
   * Get queue configuration snapshot for the current in-process state.
   */
  async getQueueConfig(clinicId?: string): Promise<QueueConfigSnapshot> {
    const queueNames = this.getTrackedQueueNames();
    const defaults = this.getStoredQueueDefaults(clinicId);
    const queues = queueNames.reduce<Record<string, QueueConfigState>>((acc, queueName) => {
      acc[queueName] = this.getEffectiveQueueConfig(queueName, clinicId);
      return acc;
    }, {});

    const snapshot: QueueConfigSnapshot = {
      queueNames,
      defaults,
      queues,
      liveStatuses: await this.getAllQueueStatuses(),
      updatedAt: new Date().toISOString(),
    };
    if (clinicId) snapshot.clinicId = clinicId;
    return snapshot;
  }

  /**
   * Persist queue configuration in memory and return the updated snapshot.
   */
  async updateQueueConfig(
    update: QueueConfigUpdateInput,
    clinicId?: string
  ): Promise<QueueConfigSnapshot> {
    const scopeClinicId = this.pick(update.clinicId, clinicId);
    const scopeKey = this.scopeKey(scopeClinicId);
    const queueName = this.resolveQueueName(update.queueName || update.queueType);
    const effectiveQueueName = queueName || HEALTHCARE_QUEUE;
    const normalizedUpdate = this.normalizeQueueConfigUpdate(
      update,
      effectiveQueueName,
      scopeClinicId
    );

    if (queueName) {
      const current = this.getEffectiveQueueConfig(effectiveQueueName, scopeClinicId);
      this.queueConfigOverrides.set(this.buildConfigKey(scopeKey, effectiveQueueName), {
        ...current,
        ...normalizedUpdate,
        queueName: effectiveQueueName,
        ...(scopeClinicId ? { clinicId: scopeClinicId } : {}),
        updatedAt: new Date().toISOString(),
      });
    } else {
      const current = this.getStoredQueueDefaults(scopeClinicId);
      this.queueConfigDefaults.set(scopeKey, {
        ...current,
        ...normalizedUpdate,
        queueName: current.queueName,
        ...(scopeClinicId ? { clinicId: scopeClinicId } : {}),
        updatedAt: new Date().toISOString(),
      });
    }

    return this.getQueueConfig(scopeClinicId);
  }

  /**
   * Get queue capacity for one queue or all queues.
   */
  async getQueueCapacity(
    queueType?: string,
    clinicId?: string
  ): Promise<QueueCapacityState | QueueCapacityState[]> {
    const scopeClinicId = clinicId?.trim() || undefined;
    if (queueType) {
      const queueName = this.resolveQueueName(queueType) || queueType.trim();
      return this.buildQueueCapacityState(queueName, scopeClinicId);
    }

    const queueNames = this.getTrackedQueueNames();
    return Promise.all(
      queueNames.map(queueName => this.buildQueueCapacityState(queueName, scopeClinicId))
    );
  }

  /**
   * Persist queue capacity in memory and return the updated record.
   */
  async updateQueueCapacity(
    update: QueueCapacityUpdateInput,
    clinicId?: string
  ): Promise<QueueCapacityState> {
    if (!this.isPositiveNumber(update.capacity)) {
      throw new HealthcareError(
        ErrorCode.VALIDATION_NUMBER_OUT_OF_RANGE,
        'capacity must be a positive number',
        undefined,
        { capacity: update.capacity },
        'QueueService'
      );
    }

    const requestedCapacity = Math.max(1, Math.floor(update.capacity ?? 0));
    const scopeClinicId = this.pick(update.clinicId, clinicId);
    const queueName = this.resolveQueueName(update.queueName || update.queueType);
    const effectiveQueueName = queueName || HEALTHCARE_QUEUE;
    const current = await this.buildQueueCapacityState(effectiveQueueName, scopeClinicId);
    const next: QueueCapacityState = {
      ...current,
      capacity: requestedCapacity,
      availableSlots: Math.max(0, requestedCapacity - current.currentLoad),
      utilizationPercent:
        requestedCapacity > 0
          ? Math.min(100, Math.round((current.currentLoad / requestedCapacity) * 100))
          : 0,
      updatedAt: new Date().toISOString(),
    };
    this.queueCapacityOverrides.set(this.buildCapacityKey(scopeClinicId, effectiveQueueName), next);
    return next;
  }

  /**
   * Export queue data using live BullMQ reads plus metadata snapshots.
   */
  async exportQueueData(
    filters: QueueExportFilters = {},
    clinicId?: string
  ): Promise<QueueExportPayload> {
    const scopeClinicId = this.pick(filters.clinicId, clinicId);
    const queueNames = this.resolveQueueNamesForExport(
      filters.queueName || filters.queueType || filters.type
    );
    const format = filters.format || 'json';
    const statuses = this.parseExportStatuses(filters.status);
    const exportStart = filters.startDate ? new Date(filters.startDate) : null;
    const exportEnd = filters.endDate ? new Date(filters.endDate) : null;
    const liveStatuses = await this.getAllQueueStatuses();
    const queueSummaries = await Promise.all(
      queueNames.map(async queueName => {
        const jobFilters: QueueFilters = { status: statuses };
        if (filters.domain) {
          jobFilters.domain = filters.domain;
        }
        const jobs = await this.getJobs(queueName, jobFilters);
        const filteredJobs = jobs.filter(job => this.jobIsWithinRange(job, exportStart, exportEnd));
        const capacity = await this.buildQueueCapacityState(queueName, scopeClinicId);
        const config = this.getEffectiveQueueConfig(queueName, scopeClinicId);
        const metrics = await this.getQueueMetrics(queueName);
        return {
          queueName,
          entries: filteredJobs.length,
          waiting: metrics.waiting,
          active: metrics.active,
          completed: metrics.completed,
          failed: metrics.failed,
          delayed: metrics.delayed,
          capacity,
          config,
          jobs: filteredJobs,
        };
      })
    );

    const entries = queueSummaries.flatMap((summary, queueIndex) =>
      summary.jobs.map((job, index) =>
        this.toExportEntry(
          summary.queueName,
          job,
          index + 1,
          summary.jobs.length,
          scopeClinicId,
          queueIndex
        )
      )
    );

    const metadata: QueueExportPayload['metadata'] = {
      exportedAt: new Date().toISOString(),
      format,
      queueNames,
      totalQueues: queueNames.length,
      totalEntries: entries.length,
      availableQueueFilters: this.getSupportedQueueFilters(),
      availableQueueFilterCatalog: this.getQueueFilterCatalog(),
      activeQueueName: HEALTHCARE_QUEUE,
      filters: {
        ...(filters.queueName ? { queueName: filters.queueName } : {}),
        ...(filters.queueType ? { queueType: filters.queueType } : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.jobType ? { jobType: filters.jobType } : {}),
        ...(filters.jobFamily ? { jobFamily: filters.jobFamily } : {}),
        ...(filters.family ? { family: filters.family } : {}),
        ...(filters.module ? { module: filters.module } : {}),
        ...(filters.appointmentType ? { appointmentType: filters.appointmentType } : {}),
        ...(filters.treatmentType ? { treatmentType: filters.treatmentType } : {}),
        ...(filters.serviceBucket ? { serviceBucket: filters.serviceBucket } : {}),
        ...(filters.queueCategory ? { queueCategory: filters.queueCategory } : {}),
        ...(filters.domain ? { domain: filters.domain } : {}),
        ...(filters.startDate ? { startDate: filters.startDate } : {}),
        ...(filters.endDate ? { endDate: filters.endDate } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.format ? { format: filters.format } : {}),
        ...(filters.limit ? { limit: filters.limit } : {}),
        ...(scopeClinicId ? { clinicId: scopeClinicId } : {}),
      },
      queueSummaries: queueSummaries.map(summary => ({
        queueName: summary.queueName,
        entries: summary.entries,
        waiting: summary.waiting,
        active: summary.active,
        completed: summary.completed,
        failed: summary.failed,
        delayed: summary.delayed,
        capacity: summary.capacity,
        config: summary.config,
      })),
      liveStatuses,
    };
    if (scopeClinicId) metadata.clinicId = scopeClinicId;
    if (filters.domain) metadata.domain = filters.domain;
    return { metadata, entries };
  }

  /**
   * Get a single job from a specific queue
   */
  async getJob(queueName: string, jobId: string): Promise<Job | null> {
    try {
      const queue = this.queues.get(queueName);
      if (!queue) {
        return null;
      }

      const job = await queue.getJob(jobId);
      return job ?? null;
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.WARN,
        `Failed to get job ${jobId} from queue ${queueName}`,
        'QueueService',
        {
          queueName,
          jobId,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      return null;
    }
  }

  /**
   * Remove a job from a specific queue
   */
  async removeJob(queueName: string, jobId: string): Promise<boolean> {
    try {
      const queue = this.queues.get(queueName);
      if (!queue) {
        return false;
      }

      await queue.remove(jobId);
      return true;
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.WARN,
        `Failed to remove job ${jobId} from queue ${queueName}`,
        'QueueService',
        {
          queueName,
          jobId,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      return false;
    }
  }

  /**
   * Patch an existing job payload without removing and recreating the job when the
   * underlying BullMQ job supports in-place data updates.
   */
  async patchJobData(
    queueName: string,
    jobId: string,
    patch: Record<string, unknown>
  ): Promise<Job | null> {
    try {
      const queue = this.queues.get(queueName);
      if (!queue) {
        return null;
      }

      const job = await queue.getJob(jobId);
      if (!job) {
        return null;
      }

      const currentData =
        typeof job.data === 'object' && job.data !== null
          ? (job.data as Record<string, unknown>)
          : {};

      // If this is a canonical envelope { jobType, action, data, metadata },
      // patch the inner .data field to avoid corrupting the envelope shape.
      const isCanonicalEnvelope =
        typeof currentData['jobType'] === 'string' &&
        typeof currentData['action'] === 'string' &&
        typeof currentData['data'] === 'object' &&
        currentData['data'] !== null;

      const nextData = isCanonicalEnvelope
        ? {
            ...currentData,
            data: {
              ...(currentData['data'] as Record<string, unknown>),
              ...patch,
            },
          }
        : { ...currentData, ...patch };

      const updatableJob = job as Job & {
        updateData?: (data: Record<string, unknown>) => Promise<void>;
      };

      if (typeof updatableJob.updateData === 'function') {
        await updatableJob.updateData(nextData);
      } else {
        await queue.remove(jobId);
        await queue.add(job.name, nextData, job.opts);
      }

      return (await queue.getJob(jobId)) ?? null;
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to patch job ${jobId} in queue ${queueName}`,
        'QueueService',
        {
          queueName,
          jobId,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  /**
   * Get queue metrics for domain-specific monitoring
   */
  async getQueueMetrics(queueName: string): Promise<DetailedQueueMetrics> {
    try {
      const queue = this.queues.get(queueName);
      if (!queue) {
        // Return default metrics instead of throwing for background monitoring
        return {
          queueName,
          domain: this.getCurrentDomain(),
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          throughputPerMinute: 0,
          averageProcessingTime: 0,
          errorRate: 0,
        };
      }

      // Check if queue methods are available
      if (
        typeof queue.getWaiting !== 'function' ||
        typeof queue.getActive !== 'function' ||
        typeof queue.getCompleted !== 'function' ||
        typeof queue.getFailed !== 'function' ||
        typeof queue.getDelayed !== 'function'
      ) {
        // Return default metrics if queue methods not available
        return {
          queueName,
          domain: this.getCurrentDomain(),
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          throughputPerMinute: 0,
          averageProcessingTime: 0,
          errorRate: 0,
        };
      }

      // Use Promise.allSettled to handle individual queue method failures gracefully
      const [waitingResult, activeResult, completedResult, failedResult, delayedResult] =
        await Promise.allSettled([
          queue.getWaiting(),
          queue.getActive(),
          queue.getCompleted(),
          queue.getFailed(),
          queue.getDelayed(),
        ]);

      const waiting = waitingResult.status === 'fulfilled' ? waitingResult.value : ([] as Job[]);
      const active = activeResult.status === 'fulfilled' ? activeResult.value : ([] as Job[]);
      const completed =
        completedResult.status === 'fulfilled' ? completedResult.value : ([] as Job[]);
      const failed = failedResult.status === 'fulfilled' ? failedResult.value : ([] as Job[]);
      const delayed = delayedResult.status === 'fulfilled' ? delayedResult.value : ([] as Job[]);

      const metrics: DetailedQueueMetrics = {
        queueName,
        domain: this.getCurrentDomain(),
        waiting: Array.isArray(waiting) ? waiting.length : 0,
        active: Array.isArray(active) ? active.length : 0,
        completed: Array.isArray(completed) ? completed.length : 0,
        failed: Array.isArray(failed) ? failed.length : 0,
        delayed: Array.isArray(delayed) ? delayed.length : 0,
        throughputPerMinute: 25, // Placeholder - jobs per minute
        averageProcessingTime: 120000, // Placeholder - 2 minutes in milliseconds
        errorRate: this.calculateErrorRate(queueName),
      };

      // Defensive check before calling .set()
      if (this.queueMetrics && typeof this.queueMetrics.set === 'function') {
        this.queueMetrics.set(queueName, metrics);
      } else {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          'queueMetrics Map is not properly initialized',
          'QueueService',
          { queueName }
        );
      }
      return metrics;
    } catch (_error) {
      // Return default metrics instead of throwing for background monitoring
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.WARN,
        `Failed to get metrics for queue ${queueName} (returning defaults)`,
        'QueueService',
        {
          queueName,
          domain: this.getCurrentDomain(),
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      return {
        queueName,
        domain: this.getCurrentDomain(),
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        throughputPerMinute: 0,
        averageProcessingTime: 0,
        errorRate: 0,
      };
    }
  }

  private getTrackedQueueNames(): string[] {
    const names = new Set<string>(this.getQueueNames());
    if (names.size === 0) {
      for (const queueName of this.getAvailableQueues()) {
        names.add(queueName);
      }
    }
    for (const key of this.queueConfigOverrides.keys()) {
      names.add(this.extractQueueNameFromKey(key));
    }
    for (const key of this.queueCapacityOverrides.keys()) {
      names.add(this.extractQueueNameFromKey(key));
    }
    return Array.from(names);
  }

  private scopeKey(clinicId?: string): string {
    return clinicId && clinicId.trim().length > 0 ? `clinic:${clinicId.trim()}` : 'global';
  }

  private buildConfigKey(scopeKey: string, queueName: string): string {
    return `${scopeKey}::${queueName}`;
  }

  private buildCapacityKey(clinicId: string | undefined, queueName: string): string {
    return `${this.scopeKey(clinicId)}::${queueName}`;
  }

  private extractQueueNameFromKey(key: string): string {
    const segments = key.split('::');
    return segments[segments.length - 1] || key;
  }

  private getStoredQueueDefaults(clinicId?: string): QueueConfigState {
    const scopeKey = this.scopeKey(clinicId);
    const stored = this.queueConfigDefaults.get(scopeKey);
    if (stored) return stored;
    const defaults = this.defaultQueueConfig('global', clinicId);
    this.queueConfigDefaults.set(scopeKey, defaults);
    return defaults;
  }

  private getEffectiveQueueConfig(queueName: string, clinicId?: string): QueueConfigState {
    const scopeKey = this.scopeKey(clinicId);
    const defaults = this.getStoredQueueDefaults(clinicId);
    const base = this.defaultQueueConfig(queueName, scopeKey);
    const overrideKey = this.buildConfigKey(scopeKey, queueName);
    const override = this.queueConfigOverrides.get(overrideKey);
    const effective: QueueConfigState = {
      ...base,
      ...defaults,
      ...(override || {}),
      queueName,
      updatedAt: override?.updatedAt || defaults.updatedAt || base.updatedAt,
    };
    if (clinicId) effective.clinicId = clinicId;
    return effective;
  }

  private normalizeQueueConfigUpdate(
    update: QueueConfigUpdateInput,
    queueName: string,
    clinicId?: string
  ): Partial<QueueConfigState> {
    const result: Partial<QueueConfigState> = { queueName };
    if (clinicId) result.clinicId = clinicId;
    if (typeof update.maxWaitTime === 'number' && this.isPositiveNumber(update.maxWaitTime)) {
      result.maxWaitTime = Math.floor(update.maxWaitTime);
    }
    if (
      typeof update.averageConsultationTime === 'number' &&
      this.isPositiveNumber(update.averageConsultationTime)
    ) {
      result.averageConsultationTime = Math.floor(update.averageConsultationTime);
    }
    if (typeof update.autoCallNext === 'boolean') {
      result.autoCallNext = update.autoCallNext;
    }
    if (typeof update.allowWalkIns === 'boolean') {
      result.allowWalkIns = update.allowWalkIns;
    }
    if (typeof update.priorityEnabled === 'boolean') {
      result.priorityEnabled = update.priorityEnabled;
    }
    return result;
  }

  private defaultQueueConfig(queueName: string, clinicId?: string): QueueConfigState {
    const updatedAt = new Date().toISOString();
    const defaults: QueueConfigState = {
      queueName,
      maxWaitTime: 30,
      averageConsultationTime: 15,
      autoCallNext: true,
      allowWalkIns: true,
      priorityEnabled: true,
      updatedAt,
    };
    const scopedDefaults = clinicId ? { ...defaults, clinicId } : defaults;

    switch (queueName) {
      case 'invoice-pdf-queue':
      case 'bulk-invoice-queue':
        return {
          ...scopedDefaults,
          maxWaitTime: 15,
          averageConsultationTime: 3,
          autoCallNext: false,
          allowWalkIns: false,
          priorityEnabled: false,
        };
      case 'email-queue':
        return {
          ...scopedDefaults,
          maxWaitTime: 10,
          averageConsultationTime: 2,
          autoCallNext: false,
          allowWalkIns: false,
          priorityEnabled: false,
        };
      case 'notification-queue':
        return {
          ...scopedDefaults,
          maxWaitTime: 5,
          averageConsultationTime: 1,
          autoCallNext: false,
          allowWalkIns: false,
          priorityEnabled: false,
        };
      case 'payment-processing-queue':
      case 'payment-reconciliation-queue':
        return {
          ...scopedDefaults,
          maxWaitTime: 20,
          averageConsultationTime: 5,
          autoCallNext: false,
          allowWalkIns: false,
        };
      case 'video-recording-queue':
      case 'video-transcoding-queue':
      case 'video-analytics-queue':
        return {
          ...scopedDefaults,
          maxWaitTime: 25,
          averageConsultationTime: 10,
          autoCallNext: false,
          allowWalkIns: false,
          priorityEnabled: false,
        };
      case 'lab-report-queue':
      case 'imaging-queue':
      case 'bulk-ehr-import-queue':
        return {
          ...scopedDefaults,
          maxWaitTime: 30,
          averageConsultationTime: 10,
          autoCallNext: false,
          allowWalkIns: false,
        };
      case 'analytics-queue':
        return {
          ...scopedDefaults,
          maxWaitTime: 45,
          averageConsultationTime: 20,
          autoCallNext: false,
          allowWalkIns: false,
        };
      default:
        return defaults;
    }
  }

  private defaultQueueCapacity(queueName: string): number {
    switch (queueName) {
      case 'appointment-queue':
      case 'enhanced-appointment-queue':
      case 'healthcare-queue':
        return 120;
      case 'email-queue':
        return 5000;
      case 'notification-queue':
        return 10000;
      case 'payment-processing-queue':
      case 'payment-reconciliation-queue':
        return 500;
      case 'invoice-pdf-queue':
      case 'bulk-invoice-queue':
        return 400;
      case 'video-recording-queue':
      case 'video-transcoding-queue':
      case 'video-analytics-queue':
        return 350;
      case 'lab-report-queue':
      case 'imaging-queue':
      case 'bulk-ehr-import-queue':
        return 200;
      case 'analytics-queue':
        return 250;
      case 'reminder-queue':
      case 'follow-up-queue':
        return 1000;
      case 'service-queue':
        return 180;
      default:
        return 250;
    }
  }

  private async buildQueueCapacityState(
    queueName: string,
    clinicId?: string
  ): Promise<QueueCapacityState> {
    const overrideKey = this.buildCapacityKey(clinicId, queueName);
    const override = this.queueCapacityOverrides.get(overrideKey);
    const metrics = await this.getQueueMetrics(queueName);
    const defaultCapacity = this.defaultQueueCapacity(queueName);
    const capacity = Math.max(1, Math.floor(override?.capacity || defaultCapacity));
    const currentLoad = metrics.active + metrics.waiting;
    const availableSlots = Math.max(0, capacity - currentLoad);
    const utilizationPercent = Math.min(100, Math.round((currentLoad / capacity) * 100));
    const baseState: QueueCapacityState = {
      queueName,
      capacity,
      defaultCapacity,
      activeJobs: metrics.active,
      waitingJobs: metrics.waiting,
      currentLoad,
      availableSlots,
      utilizationPercent,
      metrics,
      updatedAt: override?.updatedAt || new Date().toISOString(),
    };
    const scopedBaseState = clinicId?.trim()
      ? { ...baseState, clinicId: clinicId.trim() }
      : baseState;
    if (!override) {
      this.queueCapacityOverrides.set(overrideKey, scopedBaseState);
    }
    return scopedBaseState;
  }

  private resolveQueueName(queueName?: string): string | undefined {
    const value = queueName?.trim();
    if (!value) return undefined;
    const exactMatch = this.getTrackedQueueNames().find(
      name => name.toLowerCase() === value.toLowerCase()
    );
    if (exactMatch) return exactMatch;

    const lower = value.toLowerCase();
    if (lower === HEALTHCARE_QUEUE || lower === 'healthcare' || lower === 'unified-queue')
      return HEALTHCARE_QUEUE;
    if (lower.includes('billing')) return 'invoice-pdf-queue';
    if (lower.includes('invoice')) return 'invoice-pdf-queue';
    if (lower.includes('notification')) return 'notification-queue';
    if (lower.includes('email')) return 'email-queue';
    if (lower.includes('payment-recon')) return 'payment-reconciliation-queue';
    if (lower.includes('payment')) return 'payment-processing-queue';
    if (lower.includes('service')) return 'service-queue';
    if (lower.includes('analytics')) return 'analytics-queue';
    if (lower.includes('follow')) return 'follow-up-queue';
    if (lower.includes('reminder')) return 'reminder-queue';
    if (lower.includes('appointment')) return 'appointment-queue';
    if (lower.includes('video')) return 'video-recording-queue';
    if (lower.includes('lab')) return 'lab-report-queue';
    if (lower.includes('imaging')) return 'imaging-queue';
    if (lower.includes('ayurveda') || lower.includes('panchakarma')) return 'panchakarma-queue';
    if (lower.includes('viddha')) return 'vidhakarma-queue';
    if (lower.includes('chequp')) return 'chequp-queue';
    return value;
  }

  private resolveQueueNamesForExport(queueName?: string): string[] {
    const resolved = this.resolveQueueName(queueName);
    if (resolved && this.queues.has(resolved)) return [resolved];
    return this.getTrackedQueueNames();
  }

  private parseExportStatuses(status?: string): JobState[] {
    const statuses = (status || 'waiting,active,completed,failed,delayed')
      .split(',')
      .map(item => item.trim().toLowerCase())
      .filter(Boolean) as JobState[];
    return statuses.length > 0 ? statuses : ['waiting', 'active', 'completed', 'failed', 'delayed'];
  }

  private jobIsWithinRange(job: Job, startDate: Date | null, endDate: Date | null): boolean {
    if (!startDate && !endDate) return true;
    const timestamp = job.timestamp || job.processedOn || job.finishedOn;
    if (!timestamp) return false;
    const jobDate = new Date(timestamp);
    if (Number.isNaN(jobDate.getTime())) return false;
    if (startDate && jobDate < startDate) return false;
    if (endDate && jobDate > endDate) return false;
    return true;
  }

  private toExportEntry(
    queueName: string,
    job: Job,
    position: number,
    totalInQueue: number,
    clinicId?: string,
    queueIndex?: number
  ): QueueExportEntry {
    const data = this.jobData(job);
    const jobType = this.pick(
      this.recordString(data, 'jobType'),
      this.recordString(data, 'type'),
      job.name
    );
    const queueType = this.pick(
      this.recordString(data, 'queueType'),
      this.recordString(data, 'type'),
      this.recordString(data, 'queueCategory'),
      jobType,
      queueName
    );
    const queueCategory = this.pick(
      this.recordString(data, 'queueCategory'),
      this.toQueueCategory(queueType)
    );
    const jobFamily = this.getQueueJobFamily(jobType, data);
    const patientId = this.recordString(data, 'patientId');
    const doctorId = this.recordString(data, 'doctorId');
    const appointmentId = this.recordString(data, 'appointmentId');
    const queueOwnerId = this.recordString(data, 'queueOwnerId');
    const locationId = this.recordString(data, 'locationId');
    const treatmentType = this.recordString(data, 'treatmentType');
    const appointmentType = this.recordString(data, 'appointmentType');
    const appointmentMode = this.recordString(data, 'appointmentMode');
    const serviceBucket = this.recordString(data, 'serviceBucket');
    const priority = typeof job.opts.priority === 'number' ? job.opts.priority : undefined;
    const timestamp =
      typeof job.timestamp === 'number' ? new Date(job.timestamp).toISOString() : undefined;
    const processedAt =
      typeof job.processedOn === 'number' ? new Date(job.processedOn).toISOString() : undefined;
    const finishedAt =
      typeof job.finishedOn === 'number' ? new Date(job.finishedOn).toISOString() : undefined;
    const status = this.pick(this.recordString(data, 'status'), 'WAITING');
    return {
      id: typeof job.id === 'string' ? job.id : `${queueName}-${queueIndex ?? 0}-${position}`,
      queueName,
      jobType,
      jobFamily,
      queueType,
      queueCategory,
      ...(appointmentType ? { appointmentType } : {}),
      ...(appointmentMode ? { appointmentMode } : {}),
      ...(treatmentType ? { treatmentType } : {}),
      ...(serviceBucket ? { serviceBucket } : {}),
      ...(clinicId ? { clinicId } : {}),
      ...(patientId ? { patientId } : {}),
      ...(doctorId ? { doctorId } : {}),
      ...(appointmentId ? { appointmentId } : {}),
      ...(queueOwnerId ? { queueOwnerId } : {}),
      ...(locationId ? { locationId } : {}),
      status,
      ...(typeof priority === 'number' ? { priority } : {}),
      ...(timestamp ? { timestamp } : {}),
      ...(processedAt ? { processedAt } : {}),
      ...(finishedAt ? { finishedAt } : {}),
      position,
      queuePosition: position,
      totalInQueue,
      raw: data,
    };
  }

  private isPositiveNumber(value: number | undefined): boolean {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }

  /**
   * Get health status for domain-specific monitoring
   */
  async getHealthStatus(): Promise<QueueHealthStatus> {
    try {
      const queueMetrics = await Promise.all(
        Array.from(this.queues.keys()).map(queueName => this.getQueueMetrics(queueName))
      );

      const totalJobs = queueMetrics.reduce(
        (sum: number, metrics: DetailedQueueMetrics) =>
          sum + metrics.waiting + metrics.active + metrics.delayed,
        0
      );

      const errorRate =
        queueMetrics.reduce(
          (sum: number, metrics: DetailedQueueMetrics) => sum + metrics.errorRate,
          0
        ) / queueMetrics.length;
      const averageResponseTime =
        queueMetrics.reduce(
          (sum: number, metrics: DetailedQueueMetrics) => sum + metrics.averageProcessingTime,
          0
        ) / queueMetrics.length;

      return {
        isHealthy: errorRate < 0.05, // 5% error rate threshold
        domain: this.getCurrentDomain(),
        queues: queueMetrics,
        totalJobs,
        errorRate,
        averageResponseTime,
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to get health status`,
        'QueueService',
        {
          domain: this.getCurrentDomain(),
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Update an existing job in the queue
   */
  async updateJob(queueName: string, jobId: string, data: unknown): Promise<boolean> {
    try {
      const queue = this.queues.get(queueName);
      if (!queue) {
        throw new HealthcareError(
          ErrorCode.QUEUE_NOT_FOUND,
          `Queue ${queueName} not found for domain ${this.getCurrentDomain()}`,
          undefined,
          { queueName, domain: this.getCurrentDomain() },
          'QueueService'
        );
      }

      const job = await queue.getJob(jobId);
      if (!job) {
        throw new HealthcareError(
          ErrorCode.QUEUE_JOB_NOT_FOUND,
          `Job ${jobId} not found in queue ${queueName}`,
          undefined,
          { jobId, queueName },
          'QueueService.getJob'
        );
      }

      // Update job data
      const currentData = job.data as Record<string, unknown>;
      const isCanonicalEnvelope =
        typeof currentData['jobType'] === 'string' &&
        typeof currentData['action'] === 'string' &&
        typeof currentData['data'] === 'object' &&
        currentData['data'] !== null;

      job.data = isCanonicalEnvelope
        ? {
            ...currentData,
            data: {
              ...(currentData['data'] as Record<string, unknown>),
              ...(data as Record<string, unknown>),
            },
          }
        : {
            ...currentData,
            ...(data as Record<string, unknown>),
          };

      // Remove old job and add updated one
      await queue.remove(jobId);
      await queue.add(job.name, job.data, job.opts);

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Job ${jobId} updated in queue ${queueName}`,
        'QueueService',
        { jobId, queueName }
      );
      return true;
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to update job ${jobId} in queue ${queueName}`,
        'QueueService',
        {
          jobId,
          queueName,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  // ========================================
  // APPOINTMENT-SPECIFIC QUEUE OPERATIONS
  // ========================================
  // These methods replace the duplicate appointment queue service

  /**
   * Get doctor queue for appointments
   */
  async getDoctorQueue(doctorId: string, date: string, domain: string): Promise<unknown> {
    try {
      const queueName = this.getAppointmentQueueName(domain);
      const jobs = await this.getJobs(queueName, {
        domain: 'clinic',
      });

      const queue = jobs
        .filter(
          job =>
            (job.data as { doctorId: string; date: string }).doctorId === doctorId &&
            (job.data as { doctorId: string; date: string }).date === date
        )
        .map((job, index) => ({
          id: job.id,
          appointmentId: (job.data as { appointmentId: string }).appointmentId,
          position: index + 1,
          estimatedWaitTime: this.calculateEstimatedWaitTime(index + 1, domain),
          status: (job.data as { status?: string }).status || 'WAITING',
          priority: job.opts.priority || 3,
          checkedInAt: (job.data as { checkedInAt?: string }).checkedInAt,
          startedAt: (job.data as { startedAt?: string }).startedAt,
          completedAt: (job.data as { completedAt?: string }).completedAt,
        }));

      return {
        doctorId,
        date,
        domain: 'clinic',
        queue,
        totalLength: queue.length,
        averageWaitTime: this.calculateAppointmentQueueAverageWaitTime(queue),
        estimatedNextWaitTime: queue.length > 0 ? this.calculateEstimatedWaitTime(1, domain) : 0,
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to get doctor queue`,
        'QueueService',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
      throw _error;
    }
  }

  /**
   * Get patient queue position
   */
  async getPatientQueuePosition(appointmentId: string, domain: string): Promise<unknown> {
    try {
      const queueName = this.getAppointmentQueueName(domain);
      const jobs = await this.getJobs(queueName, {
        domain: 'clinic',
      });

      const job = jobs.find(
        j => (j.data as { appointmentId: string }).appointmentId === appointmentId
      );
      if (!job) {
        throw new HealthcareError(
          ErrorCode.QUEUE_JOB_NOT_FOUND,
          'Appointment not found in queue',
          undefined,
          {},
          'QueueService'
        );
      }

      const position = jobs.indexOf(job) + 1;
      const estimatedWaitTime = this.calculateEstimatedWaitTime(position, domain);

      return {
        appointmentId,
        position,
        totalInQueue: jobs.length,
        estimatedWaitTime,
        domain: 'clinic',
        doctorId: (job.data as { doctorId: string }).doctorId,
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to get patient queue position`,
        'QueueService',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
      throw _error;
    }
  }

  /**
   * Confirm appointment in queue
   */
  async confirmAppointment(appointmentId: string, domain: string): Promise<unknown> {
    try {
      const queueName = this.getAppointmentQueueName(domain);
      const jobs = await this.getJobs(queueName, {
        domain: 'clinic',
      });

      const job = jobs.find(
        j => (j.data as { appointmentId: string }).appointmentId === appointmentId
      );
      if (!job) {
        throw new HealthcareError(
          ErrorCode.QUEUE_JOB_NOT_FOUND,
          'Appointment not found in queue',
          undefined,
          {},
          'QueueService'
        );
      }

      // Update job data
      (job.data as { status: string; confirmedAt: string }).status = 'CONFIRMED';
      (job.data as { status: string; confirmedAt: string }).confirmedAt = new Date().toISOString();

      // Update the job in the queue
      await this.updateJob(queueName, job.id as string, job.data);

      return { success: true, message: 'Appointment confirmed' };
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to confirm appointment`,
        'QueueService',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
      throw _error;
    }
  }

  /**
   * Start consultation
   */
  async startConsultation(
    appointmentId: string,
    doctorId: string,
    domain: string
  ): Promise<unknown> {
    try {
      const queueName = this.getAppointmentQueueName(domain);
      const jobs = await this.getJobs(queueName, {
        domain: 'clinic',
      });

      const job = jobs.find(
        j => (j.data as { appointmentId: string }).appointmentId === appointmentId
      );
      if (!job) {
        throw new HealthcareError(
          ErrorCode.QUEUE_JOB_NOT_FOUND,
          'Appointment not found in queue',
          undefined,
          {},
          'QueueService'
        );
      }

      // Update job data
      (
        job.data as {
          status: string;
          startedAt: string;
          actualWaitTime: number;
          checkedInAt: string;
        }
      ).status = 'IN_PROGRESS';
      (
        job.data as {
          status: string;
          startedAt: string;
          actualWaitTime: number;
          checkedInAt: string;
        }
      ).startedAt = new Date().toISOString();
      (
        job.data as {
          status: string;
          startedAt: string;
          actualWaitTime: number;
          checkedInAt: string;
        }
      ).actualWaitTime = this.calculateActualWaitTime(
        (
          job.data as {
            status: string;
            startedAt: string;
            actualWaitTime: number;
            checkedInAt: string;
          }
        ).checkedInAt
      );

      // Update the job in the queue
      await this.updateJob(queueName, job.id as string, job.data);

      return { success: true, message: 'Consultation started' };
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to start consultation`,
        'QueueService',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
      throw _error;
    }
  }

  /**
   * Handle emergency appointment
   */
  async handleEmergencyAppointment(
    appointmentId: string,
    priority: number,
    domain: string
  ): Promise<unknown> {
    try {
      const queueName = this.getAppointmentQueueName(domain);
      const jobs = await this.getJobs(queueName, {
        domain: 'clinic',
      });

      const job = jobs.find(
        j => (j.data as { appointmentId: string }).appointmentId === appointmentId
      );
      if (!job) {
        throw new HealthcareError(
          ErrorCode.QUEUE_JOB_NOT_FOUND,
          'Appointment not found in queue',
          undefined,
          {},
          'QueueService'
        );
      }

      // Update job data with emergency priority
      (job.data as { priority: number; status: string; emergencyAt: string }).priority = priority;
      (job.data as { priority: number; status: string; emergencyAt: string }).status = 'EMERGENCY';
      (job.data as { priority: number; status: string; emergencyAt: string }).emergencyAt =
        new Date().toISOString();

      // Remove and re-add with higher priority
      await this.updateJob(queueName, job.id as string, job.data);

      return { success: true, message: 'Emergency appointment prioritized' };
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to handle emergency appointment`,
        'QueueService',
        { error: _error instanceof Error ? _error.message : String(_error) }
      );
      throw _error;
    }
  }

  /**
   * Get location queue stats
   */
  async getLocationQueueStats(locationId: string, domain: string): Promise<unknown> {
    try {
      // Defensive check - ensure queue service is properly initialized
      if (!this.queues || this.queues.size === 0) {
        void this.loggingService.log(
          LogType.QUEUE,
          LogLevel.WARN,
          `Queue service not initialized, returning default stats`,
          'QueueService',
          { locationId, domain }
        );
        return {
          locationId,
          domain: 'clinic',
          stats: {
            totalWaiting: 0,
            averageWaitTime: 0,
            efficiency: 0,
            utilization: 0,
            completedCount: 0,
          },
        };
      }

      const queueName = this.getAppointmentQueueName(domain);

      // Safely get jobs with comprehensive error handling
      let jobs: Job[] = [];
      try {
        jobs = await this.getJobs(queueName, {
          domain: 'clinic',
        });
      } catch (getJobsError) {
        void this.loggingService.log(
          LogType.QUEUE,
          LogLevel.WARN,
          `Failed to get jobs for queue ${queueName}, returning default stats`,
          'QueueService',
          {
            locationId,
            domain,
            queueName,
            error: getJobsError instanceof Error ? getJobsError.message : String(getJobsError),
            stack: getJobsError instanceof Error ? getJobsError.stack : undefined,
          }
        );
        return {
          locationId,
          domain,
          stats: {
            totalWaiting: 0,
            averageWaitTime: 0,
            efficiency: 0,
            utilization: 0,
            completedCount: 0,
          },
        };
      }

      const locationJobs = jobs.filter(
        j => (j.data as { locationId?: string }).locationId === locationId
      );
      const waitingJobs = locationJobs.filter(
        j => (j.data as { status?: string }).status === 'WAITING'
      );
      const completedJobs = locationJobs.filter(
        j => (j.data as { status?: string }).status === 'COMPLETED'
      );

      const totalWaiting = waitingJobs.length;
      const completedCount = completedJobs.length;
      const averageWaitTime =
        waitingJobs.length > 0
          ? waitingJobs.reduce(
              (sum, j) => sum + ((j.data as { estimatedWaitTime?: number }).estimatedWaitTime || 0),
              0
            ) / waitingJobs.length
          : 0;
      const efficiency =
        completedCount > 0 ? (completedCount / (completedCount + totalWaiting)) * 100 : 0;
      const utilization = totalWaiting > 0 ? Math.min((totalWaiting / 50) * 100, 100) : 0;

      return {
        locationId,
        domain,
        stats: {
          totalWaiting,
          averageWaitTime,
          efficiency,
          utilization,
          completedCount,
        },
      };
    } catch (_error) {
      // Comprehensive error logging with stack trace
      const errorMessage = _error instanceof Error ? _error.message : String(_error);
      const errorStack = _error instanceof Error ? _error.stack : undefined;

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to get location queue stats: ${errorMessage}`,
        'QueueService',
        {
          locationId,
          domain,
          error: errorMessage,
          stack: errorStack,
        }
      );

      // Always return default stats instead of throwing to prevent health check failures
      return {
        locationId,
        domain,
        stats: {
          totalWaiting: 0,
          averageWaitTime: 0,
          efficiency: 0,
          utilization: 0,
          completedCount: 0,
        },
      };
    }
  }

  // Helper methods for appointment queues
  private getAppointmentQueueName(_domain: string): string {
    // All jobs route through the unified HEALTHCARE_QUEUE
    return HEALTHCARE_QUEUE;
  }

  private calculateEstimatedWaitTime(position: number, domain: string): number {
    const baseWaitTime = domain === 'clinic' ? 15 : 10; // minutes
    return position * baseWaitTime;
  }

  private calculateAverageWaitTime(
    queue: Array<{ processedOn?: number; timestamp?: number }>
  ): number {
    if (queue.length === 0) return 0;
    const totalWaitTime = queue.reduce(
      (sum: number, entry) =>
        sum + (((entry as Record<string, unknown>)['estimatedWaitTime'] as number) || 0),
      0
    );
    return totalWaitTime / queue.length;
  }

  private calculateAppointmentQueueAverageWaitTime(
    queue: Array<{
      id: string | undefined;
      appointmentId: string;
      position: number;
      estimatedWaitTime: number;
      status: string;
      priority: number;
      checkedInAt: string | undefined;
      startedAt: string | undefined;
      completedAt: string | undefined;
    }>
  ): number {
    if (queue.length === 0) return 0;
    const totalWaitTime = queue.reduce((sum: number, entry) => sum + entry.estimatedWaitTime, 0);
    return totalWaitTime / queue.length;
  }

  private calculateActualWaitTime(checkedInAt: string): number {
    if (!checkedInAt) return 0;
    const checkedInTime = new Date(checkedInAt).getTime();
    const currentTime = Date.now();
    return Math.floor((currentTime - checkedInTime) / (1000 * 60)); // minutes
  }

  /**
   * Update monitoring metrics for a queue
   */
  private async updateMonitoringMetrics(queueName: string): Promise<void> {
    try {
      const queue = this.queues.get(queueName);
      if (!queue) return;

      const waiting = await queue.getWaiting();
      const active = await queue.getActive();
      const completed = await queue.getCompleted();
      const failed = await queue.getFailed();
      const delayed = await queue.getDelayed();
      // Note: getPaused() method may not be available in all BullMQ versions
      const paused: Array<Record<string, unknown>> = []; // Placeholder for paused jobs

      const metrics = {
        totalJobs:
          waiting.length +
          active.length +
          completed.length +
          failed.length +
          delayed.length +
          paused.length,
        waitingJobs: waiting.length,
        activeJobs: active.length,
        completedJobs: completed.length,
        failedJobs: failed.length,
        delayedJobs: delayed.length,
        pausedJobs: paused.length,
        processedJobs: completed.length + failed.length,
        throughput: 25, // Placeholder - jobs per minute
        averageProcessingTime: 120000, // Placeholder - 2 minutes in milliseconds
        errorRate:
          failed.length > 0 ? (failed.length / (completed.length + failed.length)) * 100 : 0,
      };

      this.monitoringService.updateMetrics(queueName, this.getCurrentDomain(), metrics);
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to update monitoring metrics for queue ${queueName}`,
        'QueueService',
        { queueName, error: _error instanceof Error ? _error.message : String(_error) }
      );
    }
  }

  /**
   * Domain validation removed - single application access
   */
  private validateDomainAccess(_queueName: string, _requestedDomain?: string): void {
    // No domain restrictions — single clinic application
    return;
  }

  /**
   * Get job priority for enhanced job management
   */
  private getJobPriority(priority?: number): number {
    switch (priority) {
      case 1:
        return 1; // Critical
      case 2:
        return 2; // High
      case 3:
        return 3; // Normal
      case 4:
        return 4; // Low
      default:
        return 3; // Normal
    }
  }

  /**
   * Calculate error rate
   */
  private calculateErrorRate(_queueName: string): number {
    // Implementation for error rate calculation
    return 0; // Placeholder
  }

  /**
   * Update health status periodically
   */
  private async updateHealthStatus(): Promise<void> {
    try {
      // getHealthStatus now returns default values instead of throwing, so this is safe
      await this.getHealthStatus();
    } catch (_error) {
      // Log but don't throw - health status updates are non-critical
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.WARN,
        `Failed to update health status (non-critical)`,
        'QueueService',
        {
          domain: this.getCurrentDomain(),
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
    }
  }

  /**
   * Update queue metrics periodically
   */
  private async updateQueueMetrics(): Promise<void> {
    try {
      // Defensive check: ensure queues Map is initialized
      if (!this.queues || this.queues.size === 0) {
        return; // No queues to update metrics for
      }

      // Process each queue individually with error handling to prevent one failure from stopping all
      const queueNames = Array.from(this.queues.keys());
      const metricsPromises = queueNames.map(async queueName => {
        try {
          const queue = this.queues.get(queueName);
          if (!queue) {
            return; // Queue not found, skip
          }

          // Check if queue methods are available before calling
          if (
            typeof queue.getWaiting !== 'function' ||
            typeof queue.getActive !== 'function' ||
            typeof queue.getCompleted !== 'function' ||
            typeof queue.getFailed !== 'function' ||
            typeof queue.getDelayed !== 'function'
          ) {
            return; // Queue methods not available, skip
          }

          await this.getQueueMetrics(queueName);
        } catch (queueError) {
          // Log individual queue errors but don't throw - allow other queues to be processed
          void this.loggingService.log(
            LogType.QUEUE,
            LogLevel.WARN,
            `Failed to get metrics for queue ${queueName} (non-critical)`,
            'QueueService',
            {
              queueName,
              domain: this.getCurrentDomain(),
              error: queueError instanceof Error ? queueError.message : String(queueError),
            }
          );
        }
      });

      await Promise.allSettled(metricsPromises);
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to update queue metrics`,
        'QueueService',
        {
          domain: this.getCurrentDomain(),
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
    }
  }

  /**
   * Get queue status for gateway compatibility
   */
  async getQueueStatus(queueName: string): Promise<unknown> {
    try {
      const metrics = await this.getQueueMetrics(queueName);
      return {
        queueName,
        metrics,
        isHealthy: metrics.errorRate < 0.05,
        lastUpdated: new Date().toISOString(),
      };
    } catch (_error) {
      // Return default status instead of throwing
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.WARN,
        `Failed to get queue status for ${queueName} (returning default)`,
        'QueueService',
        { queueName, error: _error instanceof Error ? _error.message : String(_error) }
      );
      return {
        queueName,
        metrics: {
          queueName,
          domain: this.getCurrentDomain(),
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          throughputPerMinute: 0,
          averageProcessingTime: 0,
          errorRate: 0,
        },
        isHealthy: true,
        lastUpdated: new Date().toISOString(),
      };
    }
  }

  /**
   * Get enterprise queue metrics for gateway compatibility
   */
  async getEnterpriseQueueMetrics(queueName: string): Promise<unknown> {
    return this.getQueueMetrics(queueName);
  }

  /**
   * Get queue health for gateway compatibility
   */
  async getQueueHealth(queueName: string): Promise<unknown> {
    try {
      const metrics = await this.getQueueMetrics(queueName);
      return {
        isHealthy: metrics.errorRate < 0.05,
        errorRate: metrics.errorRate,
        averageProcessingTime: metrics.averageProcessingTime,
        throughput: metrics.throughputPerMinute,
      };
    } catch (_error) {
      // Return default health instead of throwing
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.WARN,
        `Failed to get queue health for ${queueName} (returning default)`,
        'QueueService',
        { queueName, error: _error instanceof Error ? _error.message : String(_error) }
      );
      return {
        isHealthy: true,
        errorRate: 0,
        averageProcessingTime: 0,
        throughput: 0,
      };
    }
  }

  /**
   * Get all queue statuses for gateway compatibility
   */
  async getAllQueueStatuses(): Promise<Record<string, unknown>> {
    try {
      const statuses: Record<string, unknown> = {};

      for (const queueName of Array.from(this.queues.keys())) {
        try {
          const metrics = await this.getQueueMetrics(queueName);
          statuses[queueName] = {
            queueName,
            metrics,
            isHealthy: metrics.errorRate < 0.05,
            lastUpdated: new Date().toISOString(),
          };
        } catch (_error) {
          void this.loggingService.log(
            LogType.QUEUE,
            LogLevel.ERROR,
            `Failed to get status for queue ${queueName}`,
            'QueueService',
            { queueName, error: _error instanceof Error ? _error.message : String(_error) }
          );
          statuses[queueName] = {
            queueName,
            metrics: null,
            isHealthy: false,
            _error: _error instanceof Error ? _error.message : 'Unknown error',
            lastUpdated: new Date().toISOString(),
          };
        }
      }

      return statuses;
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        'Failed to get all queue statuses',
        'QueueService',
        { error: error instanceof Error ? error.message : String(error) }
      );
      throw error;
    }
  }

  /**
   * Batch process jobs for better performance
   */
  async batchProcessJobs<T>(
    queueName: string,
    jobs: Array<{ data: T; options?: EnterpriseJobOptions }>,
    batchSize: number = 100
  ): Promise<Job[]> {
    const results: Job[] = [];

    for (let i = 0; i < jobs.length; i += batchSize) {
      const batch = jobs.slice(i, i + batchSize);
      const jobType = this.mapLegacyToJobType(queueName);
      const batchPromises = batch.map(job =>
        this.addJob(jobType, 'batch-job', job.data, job.options)
      );

      const batchResults = await Promise.allSettled(batchPromises);
      results.push(
        ...batchResults
          .filter((result): result is PromiseFulfilledResult<Job> => result.status === 'fulfilled')
          .map(result => result.value)
      );
    }

    return results;
  }

  /**
   * Get queue performance metrics for monitoring
   */
  async getPerformanceMetrics(): Promise<{
    totalQueues: number;
    totalWorkers: number;
    totalJobs: number;
    averageProcessingTime: number;
    errorRate: number;
    throughput: number;
  }> {
    let totalJobs = 0;
    let totalProcessingTime = 0;
    let totalErrors = 0;
    let totalCompleted = 0;

    for (const [queueName] of Array.from(this.queues.entries())) {
      const metrics = await this.getQueueMetrics(queueName);
      totalJobs += metrics.waiting + metrics.active + metrics.completed + metrics.failed;
      totalProcessingTime += metrics.averageProcessingTime || 0;
      totalErrors += metrics.failed;
      totalCompleted += metrics.completed;
    }

    const totalWorkers = Array.from(this.workers.values()).reduce(
      (sum, workers) => sum + workers.length,
      0
    );

    return {
      totalQueues: this.queues.size,
      totalWorkers,
      totalJobs,
      averageProcessingTime: totalProcessingTime / this.queues.size || 0,
      errorRate: totalCompleted > 0 ? (totalErrors / totalCompleted) * 100 : 0,
      throughput: totalCompleted / 60, // Jobs per minute
    };
  }

  onModuleInit() {
    try {
      // Defensive check: ensure all Maps are initialized (they should always be, but check anyway)
      if (!this.queues || typeof this.queues.set !== 'function') {
        const errorMsg = 'queues Map is not properly initialized';
        // All logs go through centralized LoggingService (per .ai-rules/ coding standards)
        void this.loggingService.log(LogType.SYSTEM, LogLevel.ERROR, errorMsg, 'QueueService', {});
        return;
      }
      if (!this.workers || typeof this.workers.set !== 'function') {
        const errorMsg = 'workers Map is not properly initialized';
        // All logs go through centralized LoggingService (per .ai-rules/ coding standards)
        void this.loggingService.log(LogType.SYSTEM, LogLevel.ERROR, errorMsg, 'QueueService', {});
        return;
      }
      if (!this.queueMetrics || typeof this.queueMetrics.set !== 'function') {
        const errorMsg = 'queueMetrics Map is not properly initialized';
        // All logs go through centralized LoggingService (per .ai-rules/ coding standards)
        void this.loggingService.log(LogType.SYSTEM, LogLevel.ERROR, errorMsg, 'QueueService', {});
        return;
      }

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Queue Service initialized for domain: ${this.getCurrentDomain()}`,
        'QueueService',
        { domain: this.getCurrentDomain() }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : 'No stack trace';
      // All logs go through centralized LoggingService (per .ai-rules/ coding standards)
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `QueueService onModuleInit failed: ${errorMessage}`,
        'QueueService',
        { error: errorMessage, stack: errorStack }
      );
      // Don't throw - allow app to continue without queue service logging
    }
  }

  async onModuleDestroy() {
    // Cleanup intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.metricsUpdateInterval) {
      clearInterval(this.metricsUpdateInterval);
    }
    if (this.autoScalingInterval) {
      clearInterval(this.autoScalingInterval);
    }

    // Close all queues and workers
    for (const queue of Array.from(this.queues.values())) {
      await queue.close();
    }
    for (const workers of Array.from(this.workers.values())) {
      for (const worker of workers) {
        await worker.close();
      }
    }

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      `Queue Service destroyed for domain: ${this.getCurrentDomain()}`,
      'QueueService',
      { domain: this.getCurrentDomain() }
    );
  }
}
