import { Injectable } from '@nestjs/common';
import { BaseAppointmentPlugin } from '@services/appointments/plugins/base/base-plugin.service';
import { AppointmentReminderService } from '@services/appointments/plugins/reminders/appointment-reminder.service';
import type { ReminderRule } from '@core/types/appointment.types';

interface ReminderPluginData {
  operation: string;
  appointmentId?: string;
  patientId?: string;
  doctorId?: string;
  clinicId?: string;
  reminderType?: string;
  hoursBefore?: number;
  channels?: string[];
  templateData?: unknown;
  reminderId?: string;
  rule?: Omit<ReminderRule, 'id'>;
  dateRange?: { from: Date; to: Date };
  patientName?: string;
  doctorName?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  location?: string;
  clinicName?: string;
  appointmentType?: string;
  notes?: string;
  prescriptionDetails?: unknown;
  amount?: number;
  paymentUrl?: string;
}

@Injectable()
export class ClinicReminderPlugin extends BaseAppointmentPlugin {
  readonly name = 'clinic-reminder-plugin';
  readonly version = '1.0.0';
  readonly features = [
    'reminder-scheduling',
    'automated-reminders',
    'reminder-rules',
    'reminder-analytics',
  ];

  constructor(private readonly reminderService: AppointmentReminderService) {
    super();
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = this.validatePluginData(data);
    this.logPluginAction('Processing clinic reminder operation', {
      operation: pluginData.operation,
    });

    switch (pluginData.operation) {
      case 'scheduleReminder': {
        if (
          !pluginData.appointmentId ||
          !pluginData.patientId ||
          !pluginData.doctorId ||
          !pluginData.clinicId ||
          !pluginData.reminderType ||
          pluginData.hoursBefore === undefined
        ) {
          throw new Error('Missing required fields for scheduleReminder');
        }
        return await this.reminderService.scheduleReminder(
          pluginData.appointmentId,
          pluginData.patientId,
          pluginData.doctorId,
          pluginData.clinicId,
          pluginData.reminderType,
          pluginData.hoursBefore,
          pluginData.channels || [],
          pluginData.templateData
        );
      }

      case 'processScheduledReminders':
        return await this.reminderService.processScheduledReminders();

      case 'cancelReminder': {
        if (!pluginData.reminderId) {
          throw new Error('Missing required field: reminderId');
        }
        return await this.reminderService.cancelReminder(pluginData.reminderId);
      }

      case 'getReminderRules': {
        if (!pluginData.clinicId) {
          throw new Error('Missing required field: clinicId');
        }
        return await this.reminderService.getReminderRules(pluginData.clinicId);
      }

      case 'createReminderRule': {
        if (!pluginData.rule) {
          throw new Error('Missing required field: rule');
        }
        return await this.reminderService.createReminderRule(pluginData.rule);
      }

      case 'getReminderStats': {
        if (!pluginData.clinicId || !pluginData.dateRange) {
          throw new Error('Missing required fields: clinicId, dateRange');
        }
        return await this.reminderService.getReminderStats(
          pluginData.clinicId,
          pluginData.dateRange
        );
      }

      case 'scheduleAppointmentReminder':
        return await this.scheduleAppointmentReminder(data);

      case 'scheduleFollowUpReminder':
        return await this.scheduleFollowUpReminder(data);

      case 'schedulePrescriptionReminder':
        return await this.schedulePrescriptionReminder(data);

      case 'schedulePaymentReminder':
        return await this.schedulePaymentReminder(data);

      default:
        this.logPluginError('Unknown reminder operation', {
          operation: pluginData.operation,
        });
        throw new Error(`Unknown reminder operation: ${pluginData.operation}`);
    }
  }

  private validatePluginData(data: unknown): ReminderPluginData {
    if (typeof data !== 'object' || data === null) {
      throw new Error('Invalid plugin data: must be an object');
    }
    const record = data as Record<string, unknown>;
    if (typeof record['operation'] !== 'string') {
      throw new Error('Invalid plugin data: operation must be a string');
    }
    return record as unknown as ReminderPluginData;
  }

  validate(data: unknown): Promise<boolean> {
    try {
      const pluginData = this.validatePluginData(data);
      const requiredFields: Record<string, string[]> = {
        scheduleReminder: [
          'appointmentId',
          'patientId',
          'doctorId',
          'clinicId',
          'reminderType',
          'hoursBefore',
        ],
        processScheduledReminders: [],
        cancelReminder: ['reminderId'],
        getReminderRules: ['clinicId'],
        createReminderRule: ['rule'],
        getReminderStats: ['clinicId', 'dateRange'],
        scheduleAppointmentReminder: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
        scheduleFollowUpReminder: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
        schedulePrescriptionReminder: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
        schedulePaymentReminder: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
      };

      const operation = pluginData.operation;
      const required = requiredFields[operation];

      if (!required) {
        this.logPluginError('Unknown operation for validation', { operation });
        return Promise.resolve(false);
      }

      for (const field of required) {
        if (!pluginData[field as keyof ReminderPluginData]) {
          this.logPluginError(`Missing required field: ${field}`, {
            operation,
            field,
          });
          return Promise.resolve(false);
        }
      }

      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }

  /**
   * Schedule appointment reminder
   */
  private async scheduleAppointmentReminder(data: unknown): Promise<unknown> {
    const pluginData = this.validatePluginData(data);
    if (
      !pluginData.appointmentId ||
      !pluginData.patientId ||
      !pluginData.doctorId ||
      !pluginData.clinicId
    ) {
      throw new Error('Missing required fields for scheduleAppointmentReminder');
    }
    const reminderType = 'appointment_reminder';
    const hoursBefore = pluginData.hoursBefore ?? 24;
    const channels = pluginData.channels ?? ['email', 'whatsapp', 'push'];
    const templateData = {
      patientName: pluginData.patientName ?? 'Patient',
      doctorName: pluginData.doctorName ?? 'Doctor',
      appointmentDate: pluginData.appointmentDate ?? new Date().toISOString().split('T')[0],
      appointmentTime: pluginData.appointmentTime ?? '10:00',
      location: pluginData.location ?? 'Clinic',
      clinicName: pluginData.clinicName ?? 'Healthcare Clinic',
      appointmentType: pluginData.appointmentType,
      notes: pluginData.notes,
    };

    return await this.reminderService.scheduleReminder(
      pluginData.appointmentId,
      pluginData.patientId,
      pluginData.doctorId,
      pluginData.clinicId,
      reminderType,
      hoursBefore,
      channels,
      templateData
    );
  }

  /**
   * Schedule follow-up reminder
   */
  private async scheduleFollowUpReminder(data: unknown): Promise<unknown> {
    const pluginData = this.validatePluginData(data);
    if (
      !pluginData.appointmentId ||
      !pluginData.patientId ||
      !pluginData.doctorId ||
      !pluginData.clinicId
    ) {
      throw new Error('Missing required fields for scheduleFollowUpReminder');
    }
    const reminderType = 'follow_up';
    const hoursBefore = pluginData.hoursBefore ?? 168; // 1 week
    const channels = pluginData.channels ?? ['email', 'whatsapp'];
    const templateData = {
      patientName: pluginData.patientName ?? 'Patient',
      doctorName: pluginData.doctorName ?? 'Doctor',
      appointmentDate: pluginData.appointmentDate ?? new Date().toISOString().split('T')[0],
      appointmentTime: pluginData.appointmentTime ?? '10:00',
      location: pluginData.location ?? 'Clinic',
      clinicName: pluginData.clinicName ?? 'Healthcare Clinic',
      appointmentType: pluginData.appointmentType,
      notes: pluginData.notes,
    };

    return await this.reminderService.scheduleReminder(
      pluginData.appointmentId,
      pluginData.patientId,
      pluginData.doctorId,
      pluginData.clinicId,
      reminderType,
      hoursBefore,
      channels,
      templateData
    );
  }

  /**
   * Schedule prescription reminder
   */
  private async schedulePrescriptionReminder(data: unknown): Promise<unknown> {
    const pluginData = this.validatePluginData(data);
    if (
      !pluginData.appointmentId ||
      !pluginData.patientId ||
      !pluginData.doctorId ||
      !pluginData.clinicId
    ) {
      throw new Error('Missing required fields for schedulePrescriptionReminder');
    }
    const reminderType = 'prescription';
    const hoursBefore = pluginData.hoursBefore ?? 24;
    const channels = pluginData.channels ?? ['whatsapp', 'push'];
    const templateData = {
      patientName: pluginData.patientName ?? 'Patient',
      doctorName: pluginData.doctorName ?? 'Doctor',
      appointmentDate: pluginData.appointmentDate ?? new Date().toISOString().split('T')[0],
      appointmentTime: pluginData.appointmentTime ?? '10:00',
      location: pluginData.location ?? 'Clinic',
      clinicName: pluginData.clinicName ?? 'Healthcare Clinic',
      appointmentType: pluginData.appointmentType,
      notes: pluginData.notes,
      prescriptionDetails: pluginData.prescriptionDetails,
    };

    return await this.reminderService.scheduleReminder(
      pluginData.appointmentId,
      pluginData.patientId,
      pluginData.doctorId,
      pluginData.clinicId,
      reminderType,
      hoursBefore,
      channels,
      templateData
    );
  }

  /**
   * Schedule payment reminder
   */
  private async schedulePaymentReminder(data: unknown): Promise<unknown> {
    const pluginData = this.validatePluginData(data);
    if (
      !pluginData.appointmentId ||
      !pluginData.patientId ||
      !pluginData.doctorId ||
      !pluginData.clinicId
    ) {
      throw new Error('Missing required fields for schedulePaymentReminder');
    }
    const reminderType = 'payment';
    const hoursBefore = pluginData.hoursBefore ?? 24;
    const channels = pluginData.channels ?? ['email', 'whatsapp'];
    const templateData = {
      patientName: pluginData.patientName ?? 'Patient',
      doctorName: pluginData.doctorName ?? 'Doctor',
      appointmentDate: pluginData.appointmentDate ?? new Date().toISOString().split('T')[0],
      appointmentTime: pluginData.appointmentTime ?? '10:00',
      location: pluginData.location ?? 'Clinic',
      clinicName: pluginData.clinicName ?? 'Healthcare Clinic',
      appointmentType: pluginData.appointmentType,
      notes: pluginData.notes,
      amount: pluginData.amount,
      paymentUrl: pluginData.paymentUrl,
    };

    return await this.reminderService.scheduleReminder(
      pluginData.appointmentId,
      pluginData.patientId,
      pluginData.doctorId,
      pluginData.clinicId,
      reminderType,
      hoursBefore,
      channels,
      templateData
    );
  }
}
