import type { DetailedQueueMetrics } from '@core/types/queue.types';

export enum JobPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface QueueConfigState {
  queueName: string;
  clinicId?: string;
  maxWaitTime: number;
  averageConsultationTime: number;
  autoCallNext: boolean;
  allowWalkIns: boolean;
  priorityEnabled: boolean;
  updatedAt: string;
}

export interface QueueCapacityState {
  queueName: string;
  clinicId?: string;
  capacity: number;
  defaultCapacity: number;
  activeJobs: number;
  waitingJobs: number;
  currentLoad: number;
  availableSlots: number;
  utilizationPercent: number;
  metrics: DetailedQueueMetrics;
  updatedAt: string;
}

export interface QueueConfigUpdateInput {
  queueName?: string;
  queueType?: string;
  clinicId?: string;
  maxWaitTime?: number;
  averageConsultationTime?: number;
  autoCallNext?: boolean;
  allowWalkIns?: boolean;
  priorityEnabled?: boolean;
}

export interface QueueCapacityUpdateInput {
  queueName?: string;
  queueType?: string;
  clinicId?: string;
  capacity: number;
}

export interface QueueExportFilters {
  queueName?: string;
  queueType?: string;
  type?: string;
  clinicId?: string;
  domain?: 'clinic';
  startDate?: string;
  endDate?: string;
  status?: string;
  format?: 'json' | 'csv' | 'excel' | 'pdf';
  limit?: string;
}

export interface QueueExportEntry {
  id: string;
  queueName: string;
  queueType: string;
  queueCategory: string;
  clinicId?: string;
  patientId?: string;
  doctorId?: string;
  appointmentId?: string;
  queueOwnerId?: string;
  locationId?: string;
  status: string;
  priority?: number;
  timestamp?: string;
  processedAt?: string;
  finishedAt?: string;
  position: number;
  queuePosition: number;
  totalInQueue: number;
  raw: Record<string, unknown>;
}

export interface QueueExportPayload {
  metadata: {
    exportedAt: string;
    clinicId?: string;
    domain?: 'clinic';
    format: 'json' | 'csv' | 'excel' | 'pdf';
    queueNames: string[];
    totalQueues: number;
    totalEntries: number;
    filters: Omit<QueueExportFilters, 'clinicId'> & { clinicId?: string };
    queueSummaries: Array<{
      queueName: string;
      entries: number;
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
      capacity: QueueCapacityState;
      config: QueueConfigState;
    }>;
    liveStatuses: Record<string, unknown>;
  };
  entries: QueueExportEntry[];
}

export interface QueueConfigSnapshot {
  clinicId?: string;
  queueNames: string[];
  defaults: QueueConfigState;
  queues: Record<string, QueueConfigState>;
  liveStatuses: Record<string, unknown>;
  updatedAt: string;
}

/**
 * Lean, unified Queue Service Interface for service-level adoption
 * Used by other modules to dispatch background jobs safely
 */
export interface IQueueService {
  /**
   * Adds a generic job to the background queue using the CanonicalJobEnvelope format.
   * This is the preferred method for asynchronous operations like emails and notifications.
   *
   * @param jobType - The overarching JobType category
   * @param action - The specific action string
   * @param data - The type-safe payload for the job
   * @param options - Optional EnterpriseJobOptions (delay, priority, attempts, etc.)
   */
  addJob<T = unknown>(
    jobType: string,
    action: string,
    data: T,
    options?: Record<string, unknown>
  ): Promise<unknown>;
}
