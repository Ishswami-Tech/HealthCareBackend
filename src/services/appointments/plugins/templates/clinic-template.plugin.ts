import { Injectable, Logger } from '@nestjs/common';
import { BaseAppointmentPlugin } from '@services/appointments/plugins/base/base-plugin.service';
import { AppointmentTemplateService } from '@services/appointments/plugins/templates/appointment-template.service';
import type { AppointmentTemplate } from '@core/types/appointment.types';

@Injectable()
export class ClinicTemplatePlugin extends BaseAppointmentPlugin {
  protected readonly logger = new Logger(ClinicTemplatePlugin.name);

  constructor(private readonly templateService: AppointmentTemplateService) {
    super();
  }

  get name(): string {
    return 'clinic-template';
  }

  get version(): string {
    return '1.0.0';
  }

  get features(): string[] {
    return ['templates', 'recurring', 'series'];
  }

  getSupportedOperations(): string[] {
    return [
      'createTemplate',
      'getClinicTemplates',
      'createRecurringSeries',
      'getTemplate',
      'updateTemplate',
      'deleteTemplate',
    ];
  }

  async process(data: unknown): Promise<unknown> {
    const { operation, ...params } = data as {
      operation: string;
      [key: string]: unknown;
    };

    this.logger.log(`Processing template operation: ${operation}`, {
      operation,
      clinicId: (params as Record<string, unknown>)['clinicId'] as string,
    });

    try {
      switch (operation) {
        case 'createTemplate':
          return await this.templateService.createTemplate(
            (params as Record<string, unknown>)['templateData'] as Omit<
              AppointmentTemplate,
              'id' | 'createdAt' | 'updatedAt'
            >
          );

        case 'getClinicTemplates':
          return await this.templateService.getClinicTemplates(
            (params as Record<string, unknown>)['clinicId'] as string
          );

        case 'createRecurringSeries':
          return await this.templateService.createRecurringSeries(
            (params as Record<string, unknown>)['templateId'] as string,
            (params as Record<string, unknown>)['patientId'] as string,
            (params as Record<string, unknown>)['clinicId'] as string,
            new Date((params as Record<string, unknown>)['startDate'] as string),
            new Date((params as Record<string, unknown>)['endDate'] as string)
          );

        case 'getTemplate':
          return await this.templateService.getTemplate(
            (params as Record<string, unknown>)['templateId'] as string
          );

        case 'updateTemplate':
          return await this.templateService.updateTemplate(
            (params as Record<string, unknown>)['templateId'] as string,
            (params as Record<string, unknown>)['updateData'] as Record<string, unknown>
          );

        case 'deleteTemplate':
          return await this.templateService.deleteTemplate(
            (params as Record<string, unknown>)['templateId'] as string
          );

        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }
    } catch (_error) {
      this.logger.error(`Template operation failed: ${operation}`, {
        operation,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  validate(data: unknown): Promise<boolean> {
    const dataObj = data as Record<string, unknown>;
    const { operation, ...params } = dataObj;

    // Validate required parameters based on operation
    switch (operation) {
      case 'createTemplate':
        return Promise.resolve(
          !!(
            (params as Record<string, unknown>)['templateData'] &&
            ((params as Record<string, unknown>)['templateData'] as Record<string, unknown>)[
              'name'
            ] &&
            ((params as Record<string, unknown>)['templateData'] as Record<string, unknown>)[
              'clinicId'
            ]
          )
        );

      case 'getClinicTemplates':
        return Promise.resolve(!!(params as Record<string, unknown>)['clinicId']);

      case 'createRecurringSeries':
        return Promise.resolve(
          !!(
            (params as Record<string, unknown>)['templateId'] &&
            (params as Record<string, unknown>)['patientId'] &&
            (params as Record<string, unknown>)['clinicId'] &&
            (params as Record<string, unknown>)['startDate']
          )
        );

      case 'getTemplate':
        return Promise.resolve(!!(params as Record<string, unknown>)['templateId']);

      case 'updateTemplate':
        return Promise.resolve(
          !!(
            (params as Record<string, unknown>)['templateId'] &&
            (params as Record<string, unknown>)['updateData']
          )
        );

      case 'deleteTemplate':
        return Promise.resolve(!!(params as Record<string, unknown>)['templateId']);

      default:
        return Promise.resolve(false);
    }
  }

  getRequiredParameters(operation: string): string[] {
    switch (operation) {
      case 'createTemplate':
        return ['templateData'];
      case 'getClinicTemplates':
        return ['clinicId'];
      case 'createRecurringSeries':
        return ['templateId', 'patientId', 'clinicId', 'startDate'];
      case 'getTemplate':
        return ['templateId'];
      case 'updateTemplate':
        return ['templateId', 'updateData'];
      case 'deleteTemplate':
        return ['templateId'];
      default:
        return [];
    }
  }

  getHealthMetrics(): unknown {
    return {
      plugin: this.name,
      version: this.version,
      status: 'healthy',
      operations: this.getSupportedOperations().length,
      lastCheck: new Date().toISOString(),
    };
  }
}
