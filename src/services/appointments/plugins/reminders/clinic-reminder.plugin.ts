import { Injectable } from '@nestjs/common';
import { BaseAppointmentPlugin } from '../base/base-plugin.service';
import { AppointmentReminderService } from './appointment-reminder.service';

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
    const pluginData = data as any;
    this.logPluginAction('Processing clinic reminder operation', {
      operation: pluginData.operation,
    });

    switch (pluginData.operation) {
      case 'scheduleReminder':
        return await this.reminderService.scheduleReminder(
          pluginData.appointmentId,
          pluginData.patientId,
          pluginData.doctorId,
          pluginData.clinicId,
          pluginData.reminderType,
          pluginData.hoursBefore,
          pluginData.channels,
          pluginData.templateData
        );

      case 'processScheduledReminders':
        return await this.reminderService.processScheduledReminders();

      case 'cancelReminder':
        return await this.reminderService.cancelReminder(pluginData.reminderId);

      case 'getReminderRules':
        return await this.reminderService.getReminderRules(pluginData.clinicId);

      case 'createReminderRule':
        return await this.reminderService.createReminderRule(pluginData.rule);

      case 'getReminderStats':
        return await this.reminderService.getReminderStats(
          pluginData.clinicId,
          pluginData.dateRange
        );

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

  validate(data: unknown): Promise<boolean> {
    const pluginData = data as any;
    const requiredFields = {
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
    const required = requiredFields[operation as keyof typeof requiredFields];

    if (!required) {
      this.logPluginError('Unknown operation for validation', { operation });
      return Promise.resolve(false);
    }

    for (const field of required) {
      if (!pluginData[field]) {
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
   * Schedule appointment reminder
   */
  private async scheduleAppointmentReminder(data: unknown): Promise<unknown> {
    const pluginData = data as any;
    const reminderType = 'appointment_reminder';
    const hoursBefore = pluginData.hoursBefore || 24;
    const channels = pluginData.channels || ['email', 'whatsapp', 'push'];
    const templateData = {
      patientName: pluginData.patientName || 'Patient',
      doctorName: pluginData.doctorName || 'Doctor',
      appointmentDate: pluginData.appointmentDate || new Date().toISOString().split('T')[0],
      appointmentTime: pluginData.appointmentTime || '10:00',
      location: pluginData.location || 'Clinic',
      clinicName: pluginData.clinicName || 'Healthcare Clinic',
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
    const reminderType = 'follow_up';
    const hoursBefore = (data as any).hoursBefore || 168; // 1 week
    const channels = (data as any).channels || ['email', 'whatsapp'];
    const templateData = {
      patientName: (data as any).patientName || 'Patient',
      doctorName: (data as any).doctorName || 'Doctor',
      appointmentDate: (data as any).appointmentDate || new Date().toISOString().split('T')[0],
      appointmentTime: (data as any).appointmentTime || '10:00',
      location: (data as any).location || 'Clinic',
      clinicName: (data as any).clinicName || 'Healthcare Clinic',
      appointmentType: (data as any).appointmentType,
      notes: (data as any).notes,
    };

    return await this.reminderService.scheduleReminder(
      (data as any).appointmentId,
      (data as any).patientId,
      (data as any).doctorId,
      (data as any).clinicId,
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
    const reminderType = 'prescription';
    const hoursBefore = (data as any).hoursBefore || 24;
    const channels = (data as any).channels || ['whatsapp', 'push'];
    const templateData = {
      patientName: (data as any).patientName || 'Patient',
      doctorName: (data as any).doctorName || 'Doctor',
      appointmentDate: (data as any).appointmentDate || new Date().toISOString().split('T')[0],
      appointmentTime: (data as any).appointmentTime || '10:00',
      location: (data as any).location || 'Clinic',
      clinicName: (data as any).clinicName || 'Healthcare Clinic',
      appointmentType: (data as any).appointmentType,
      notes: (data as any).notes,
      prescriptionDetails: (data as any).prescriptionDetails,
    };

    return await this.reminderService.scheduleReminder(
      (data as any).appointmentId,
      (data as any).patientId,
      (data as any).doctorId,
      (data as any).clinicId,
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
    const reminderType = 'payment';
    const hoursBefore = (data as any).hoursBefore || 24;
    const channels = (data as any).channels || ['email', 'whatsapp'];
    const templateData = {
      patientName: (data as any).patientName || 'Patient',
      doctorName: (data as any).doctorName || 'Doctor',
      appointmentDate: (data as any).appointmentDate || new Date().toISOString().split('T')[0],
      appointmentTime: (data as any).appointmentTime || '10:00',
      location: (data as any).location || 'Clinic',
      clinicName: (data as any).clinicName || 'Healthcare Clinic',
      appointmentType: (data as any).appointmentType,
      notes: (data as any).notes,
      amount: (data as any).amount,
      paymentUrl: (data as any).paymentUrl,
    };

    return await this.reminderService.scheduleReminder(
      (data as any).appointmentId,
      (data as any).patientId,
      (data as any).doctorId,
      (data as any).clinicId,
      reminderType,
      hoursBefore,
      channels,
      templateData
    );
  }
}
