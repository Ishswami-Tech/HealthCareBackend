import { Injectable } from '@nestjs/common';
import { BaseAppointmentPlugin } from '@services/appointments/plugins/base/base-plugin.service';
import { AppointmentFollowUpService } from '@services/appointments/plugins/followup/appointment-followup.service';
import type { FollowUpTemplate } from '@core/types/appointment.types';

interface FollowUpPluginData {
  operation: string;
  appointmentId?: string;
  patientId?: string;
  doctorId?: string;
  clinicId?: string;
  followUpType?: string;
  daysAfter?: number;
  instructions?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  medications?: string[];
  tests?: string[];
  restrictions?: string[];
  notes?: string;
  status?: 'scheduled' | 'completed' | 'cancelled' | 'overdue';
  followUpId?: string;
  template?: Omit<FollowUpTemplate, 'id'>;
}

@Injectable()
export class ClinicFollowUpPlugin extends BaseAppointmentPlugin {
  readonly name = 'clinic-followup-plugin';
  readonly version = '1.0.0';
  readonly features = [
    'follow-up-planning',
    'follow-up-reminders',
    'follow-up-templates',
    'overdue-tracking',
  ];

  constructor(private readonly followUpService: AppointmentFollowUpService) {
    super();
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = data as FollowUpPluginData;
    this.logPluginAction('Processing clinic follow-up operation', {
      operation: pluginData.operation,
    });

    switch (pluginData.operation) {
      case 'createFollowUpPlan':
        if (
          !pluginData.appointmentId ||
          !pluginData.patientId ||
          !pluginData.doctorId ||
          !pluginData.clinicId
        ) {
          throw new Error('Missing required fields for createFollowUpPlan');
        }
        if (
          !pluginData.followUpType ||
          pluginData.daysAfter === undefined ||
          !pluginData.instructions
        ) {
          throw new Error(
            'Missing required fields for createFollowUpPlan: followUpType, daysAfter, instructions'
          );
        }
        return await this.followUpService.createFollowUpPlan(
          pluginData.appointmentId,
          pluginData.patientId,
          pluginData.doctorId,
          pluginData.clinicId,
          pluginData.followUpType,
          pluginData.daysAfter,
          pluginData.instructions,
          pluginData.priority || 'normal',
          pluginData.medications,
          pluginData.tests,
          pluginData.restrictions,
          pluginData.notes
        );

      case 'getPatientFollowUps':
        if (!pluginData.patientId || !pluginData.clinicId) {
          throw new Error('Missing required fields for getPatientFollowUps');
        }
        return await this.followUpService.getPatientFollowUps(
          pluginData.patientId,
          pluginData.clinicId,
          pluginData.status || undefined
        );

      case 'updateFollowUpStatus':
        if (!pluginData.followUpId || !pluginData.status) {
          throw new Error(
            'Missing required fields for updateFollowUpStatus: followUpId and status'
          );
        }
        return await this.followUpService.updateFollowUpStatus(
          pluginData.followUpId,
          pluginData.status,
          pluginData.notes
        );

      case 'getFollowUpTemplates':
        if (!pluginData.clinicId) {
          throw new Error('Missing required field clinicId for getFollowUpTemplates');
        }
        return await this.followUpService.getFollowUpTemplates(pluginData.clinicId);

      case 'createFollowUpTemplate':
        if (!pluginData.template) {
          throw new Error('Missing required field template for createFollowUpTemplate');
        }
        return await this.followUpService.createFollowUpTemplate(pluginData.template);

      case 'getOverdueFollowUps':
        if (!pluginData.clinicId) {
          throw new Error('Missing required field clinicId for getOverdueFollowUps');
        }
        return await this.followUpService.getOverdueFollowUps(pluginData.clinicId);

      case 'createRoutineFollowUp':
        return await this.createRoutineFollowUp(data);

      case 'createUrgentFollowUp':
        return await this.createUrgentFollowUp(data);

      case 'createSpecialistFollowUp':
        return await this.createSpecialistFollowUp(data);

      case 'createTherapyFollowUp':
        return await this.createTherapyFollowUp(data);

      case 'createSurgeryFollowUp':
        return await this.createSurgeryFollowUp(data);

      default:
        this.logPluginError('Unknown follow-up operation', {
          operation: pluginData.operation,
        });
        throw new Error(`Unknown follow-up operation: ${pluginData.operation}`);
    }
  }

  validate(data: unknown): Promise<boolean> {
    const pluginData = data as FollowUpPluginData;
    const requiredFields: Record<string, string[]> = {
      createFollowUpPlan: [
        'appointmentId',
        'patientId',
        'doctorId',
        'clinicId',
        'followUpType',
        'daysAfter',
        'instructions',
      ],
      getPatientFollowUps: ['patientId', 'clinicId'],
      updateFollowUpStatus: ['followUpId', 'status'],
      getFollowUpTemplates: ['clinicId'],
      createFollowUpTemplate: ['template'],
      getOverdueFollowUps: ['clinicId'],
      createRoutineFollowUp: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
      createUrgentFollowUp: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
      createSpecialistFollowUp: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
      createTherapyFollowUp: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
      createSurgeryFollowUp: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
    };

    const operation = pluginData.operation;
    const required = requiredFields[operation];

    if (!required) {
      this.logPluginError('Unknown operation for validation', { operation });
      return Promise.resolve(false);
    }

    for (const field of required) {
      const fieldValue = (pluginData as unknown as Record<string, unknown>)[field];
      if (!fieldValue) {
        this.logPluginError(`Missing required field: ${field}`, {
          operation,
          field,
        });
        return Promise.resolve(false);
      }
    }

    return Promise.resolve(true);
  }

  /**
   * Create routine follow-up
   */
  private async createRoutineFollowUp(data: unknown): Promise<unknown> {
    const pluginData = data as FollowUpPluginData;
    if (
      !pluginData.appointmentId ||
      !pluginData.patientId ||
      !pluginData.doctorId ||
      !pluginData.clinicId
    ) {
      throw new Error('Missing required fields for createRoutineFollowUp');
    }
    const followUpType = 'routine';
    const daysAfter = pluginData.daysAfter || 7;
    const instructions =
      pluginData.instructions || 'Routine follow-up appointment to monitor progress';
    const priority = pluginData.priority || 'normal';

    return await this.followUpService.createFollowUpPlan(
      pluginData.appointmentId,
      pluginData.patientId,
      pluginData.doctorId,
      pluginData.clinicId,
      followUpType,
      daysAfter,
      instructions,
      priority,
      pluginData.medications,
      pluginData.tests,
      pluginData.restrictions,
      pluginData.notes
    );
  }

  /**
   * Create urgent follow-up
   */
  private async createUrgentFollowUp(data: unknown): Promise<unknown> {
    const pluginData = data as FollowUpPluginData;
    if (
      !pluginData.appointmentId ||
      !pluginData.patientId ||
      !pluginData.doctorId ||
      !pluginData.clinicId
    ) {
      throw new Error('Missing required fields for createUrgentFollowUp');
    }
    const followUpType = 'urgent';
    const daysAfter = pluginData.daysAfter || 1;
    const instructions = pluginData.instructions || 'Urgent follow-up appointment required';
    const priority = 'urgent';

    return await this.followUpService.createFollowUpPlan(
      pluginData.appointmentId,
      pluginData.patientId,
      pluginData.doctorId,
      pluginData.clinicId,
      followUpType,
      daysAfter,
      instructions,
      priority,
      pluginData.medications,
      pluginData.tests,
      pluginData.restrictions,
      pluginData.notes
    );
  }

  /**
   * Create specialist follow-up
   */
  private async createSpecialistFollowUp(data: unknown): Promise<unknown> {
    const pluginData = data as FollowUpPluginData;
    if (
      !pluginData.appointmentId ||
      !pluginData.patientId ||
      !pluginData.doctorId ||
      !pluginData.clinicId
    ) {
      throw new Error('Missing required fields for createSpecialistFollowUp');
    }
    const followUpType = 'specialist';
    const daysAfter = pluginData.daysAfter || 14;
    const instructions = pluginData.instructions || 'Specialist follow-up appointment';
    const priority = pluginData.priority || 'high';

    return await this.followUpService.createFollowUpPlan(
      pluginData.appointmentId,
      pluginData.patientId,
      pluginData.doctorId,
      pluginData.clinicId,
      followUpType,
      daysAfter,
      instructions,
      priority,
      pluginData.medications,
      pluginData.tests,
      pluginData.restrictions,
      pluginData.notes
    );
  }

  /**
   * Create therapy follow-up
   */
  private async createTherapyFollowUp(data: unknown): Promise<unknown> {
    const pluginData = data as FollowUpPluginData;
    if (
      !pluginData.appointmentId ||
      !pluginData.patientId ||
      !pluginData.doctorId ||
      !pluginData.clinicId
    ) {
      throw new Error('Missing required fields for createTherapyFollowUp');
    }
    const followUpType = 'therapy';
    const daysAfter = pluginData.daysAfter || 3;
    const instructions =
      pluginData.instructions || 'Therapy follow-up to assess progress and adjust treatment plan';
    const priority = pluginData.priority || 'normal';

    return await this.followUpService.createFollowUpPlan(
      pluginData.appointmentId,
      pluginData.patientId,
      pluginData.doctorId,
      pluginData.clinicId,
      followUpType,
      daysAfter,
      instructions,
      priority,
      pluginData.medications,
      pluginData.tests,
      pluginData.restrictions,
      pluginData.notes
    );
  }

  /**
   * Create surgery follow-up
   */
  private async createSurgeryFollowUp(data: unknown): Promise<unknown> {
    const pluginData = data as FollowUpPluginData;
    if (
      !pluginData.appointmentId ||
      !pluginData.patientId ||
      !pluginData.doctorId ||
      !pluginData.clinicId
    ) {
      throw new Error('Missing required fields for createSurgeryFollowUp');
    }
    const followUpType = 'surgery';
    const daysAfter = pluginData.daysAfter || 14;
    const instructions =
      pluginData.instructions || 'Post-surgery follow-up to check healing and recovery';
    const priority = pluginData.priority || 'high';

    return await this.followUpService.createFollowUpPlan(
      pluginData.appointmentId,
      pluginData.patientId,
      pluginData.doctorId,
      pluginData.clinicId,
      followUpType,
      daysAfter,
      instructions,
      priority,
      pluginData.medications,
      pluginData.tests,
      pluginData.restrictions,
      pluginData.notes
    );
  }
}
