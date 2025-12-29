import { Injectable } from '@nestjs/common';
import { BaseAppointmentPlugin } from '@services/appointments/plugins/base/base-plugin.service';
import { AppointmentEligibilityService } from './appointment-eligibility.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { EligibilityCriteria } from '@core/types/appointment.types';

@Injectable()
export class ClinicEligibilityPlugin extends BaseAppointmentPlugin {
  constructor(
    private readonly eligibilityService: AppointmentEligibilityService,
    private readonly loggingService: LoggingService
  ) {
    super();
  }

  get name(): string {
    return 'clinic-eligibility';
  }

  get version(): string {
    return '1.0.0';
  }

  get features(): string[] {
    return ['eligibility', 'criteria', 'validation'];
  }

  getSupportedOperations(): string[] {
    return [
      'checkEligibility',
      'getEligibilityCriteria',
      'createEligibilityCriteria',
      'getEligibilityHistory',
      'updateEligibilityCriteria',
      'deleteEligibilityCriteria',
    ];
  }

  async process(data: unknown): Promise<unknown> {
    interface PluginData {
      operation: string;
      [key: string]: unknown;
    }

    const pluginData = data as PluginData;
    const { operation, ...params } = pluginData;

    void this.loggingService.log(
      LogType.BUSINESS,
      LogLevel.INFO,
      `Processing eligibility operation: ${operation}`,
      'ClinicEligibilityPlugin',
      {
        operation,
        patientId: params['patientId'] as string,
        clinicId: params['clinicId'] as string,
      }
    );

    try {
      switch (operation) {
        case 'checkEligibility':
          return await this.eligibilityService.checkEligibility(
            params['patientId'] as string,
            params['appointmentType'] as string,
            params['clinicId'] as string,
            params['requestedDate'] as Date
          );

        case 'getEligibilityCriteria':
          return await this.eligibilityService.getEligibilityCriteria(params['clinicId'] as string);

        case 'createEligibilityCriteria':
          return await this.eligibilityService.createEligibilityCriteria(
            params['criteriaData'] as Omit<EligibilityCriteria, 'id' | 'createdAt' | 'updatedAt'>
          );

        case 'getEligibilityHistory':
          return await this.eligibilityService.getEligibilityHistory(
            params['patientId'] as string,
            params['clinicId'] as string
          );

        case 'updateEligibilityCriteria':
          return await this.eligibilityService.updateEligibilityCriteria(
            params['criteriaId'] as string,
            params['updateData'] as Partial<
              Omit<EligibilityCriteria, 'id' | 'createdAt' | 'updatedAt'>
            >
          );

        case 'deleteEligibilityCriteria':
          return await this.eligibilityService.deleteEligibilityCriteria(
            params['criteriaId'] as string
          );

        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Eligibility operation failed: ${operation}`,
        'ClinicEligibilityPlugin',
        {
          operation,
          _error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  validate(data: unknown): Promise<boolean> {
    interface PluginData {
      operation: string;
      [key: string]: unknown;
    }

    const pluginData = data as PluginData;
    const { operation, ...params } = pluginData;

    // Validate required parameters based on operation
    switch (operation) {
      case 'checkEligibility':
        return Promise.resolve(
          !!(
            params['patientId'] &&
            params['appointmentType'] &&
            params['clinicId'] &&
            params['requestedDate']
          )
        );

      case 'getEligibilityCriteria':
        return Promise.resolve(!!params['clinicId']);

      case 'createEligibilityCriteria': {
        const criteriaData = params['criteriaData'] as
          | { name?: unknown; clinicId?: unknown }
          | undefined;
        return Promise.resolve(!!(criteriaData && criteriaData.name && criteriaData.clinicId));
      }

      case 'getEligibilityHistory':
        return Promise.resolve(!!(params['patientId'] && params['clinicId']));

      case 'updateEligibilityCriteria':
        return Promise.resolve(!!(params['criteriaId'] && params['updateData']));

      case 'deleteEligibilityCriteria':
        return Promise.resolve(!!params['criteriaId']);

      default:
        return Promise.resolve(false);
    }
  }

  getRequiredParameters(operation: string): string[] {
    switch (operation) {
      case 'checkEligibility':
        return ['patientId', 'appointmentType', 'clinicId', 'requestedDate'];
      case 'getEligibilityCriteria':
        return ['clinicId'];
      case 'createEligibilityCriteria':
        return ['criteriaData'];
      case 'getEligibilityHistory':
        return ['patientId', 'clinicId'];
      case 'updateEligibilityCriteria':
        return ['criteriaId', 'updateData'];
      case 'deleteEligibilityCriteria':
        return ['criteriaId'];
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
