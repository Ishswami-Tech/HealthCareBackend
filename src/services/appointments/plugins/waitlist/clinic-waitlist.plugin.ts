import { Injectable, Logger } from '@nestjs/common';
import { BaseAppointmentPlugin } from '../base/base-plugin.service';
import { AppointmentWaitlistService } from './appointment-waitlist.service';

@Injectable()
export class ClinicWaitlistPlugin extends BaseAppointmentPlugin {
  protected readonly logger = new Logger(ClinicWaitlistPlugin.name);

  constructor(private readonly waitlistService: AppointmentWaitlistService) {
    super();
  }

  get name(): string {
    return 'clinic-waitlist';
  }

  get version(): string {
    return '1.0.0';
  }

  get features(): string[] {
    return ['waitlist', 'priority', 'automation'];
  }

  getSupportedOperations(): string[] {
    return [
      'addToWaitlist',
      'getWaitlist',
      'processWaitlist',
      'getWaitlistMetrics',
      'removeFromWaitlist',
      'updateWaitlistEntry',
    ];
  }

  async process(data: unknown): Promise<unknown> {
    const { operation, ...params } = data as {
      operation: string;
      [key: string]: unknown;
    };

    this.logger.log(`Processing waitlist operation: ${operation}`, {
      operation,
      doctorId: params['doctorId'],
      clinicId: params['clinicId'],
    });

    try {
      switch (operation) {
        case 'addToWaitlist':
          return await this.waitlistService.addToWaitlist(
            params['patientId'] as string,
            params['doctorId'] as string,
            params['clinicId'] as string,
            params['preferredDate'] as Date,
            params['reason'] as string,
            params['priority'] as 'low' | 'normal' | 'high' | 'urgent',
            params['preferredTime'] as string | undefined
          );

        case 'getWaitlist':
          return await this.waitlistService.getWaitlist(
            params['doctorId'] as string | undefined,
            params['clinicId'] as string | undefined,
            params['status'] as string | undefined
          );

        case 'processWaitlist':
          return await this.waitlistService.processWaitlist(
            params['doctorId'] as string,
            params['clinicId'] as string
          );

        case 'getWaitlistMetrics':
          return await this.waitlistService.getWaitlistMetrics(
            params['doctorId'] as string | undefined,
            params['clinicId'] as string | undefined
          );

        case 'removeFromWaitlist':
          return await this.waitlistService.removeFromWaitlist(params['entryId'] as string);

        case 'updateWaitlistEntry':
          return await this.waitlistService.updateWaitlistEntry(
            params['entryId'] as string,
            params['updateData'] as Record<string, unknown>
          );

        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }
    } catch (_error) {
      this.logger.error(`Waitlist operation failed: ${operation}`, {
        operation,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  validate(data: unknown): Promise<boolean> {
    const { operation, ...params } = data as {
      operation: string;
      [key: string]: unknown;
    };

    // Validate required parameters based on operation
    switch (operation) {
      case 'addToWaitlist':
        return Promise.resolve(
          !!(
            params['patientId'] &&
            params['doctorId'] &&
            params['clinicId'] &&
            params['preferredDate'] &&
            params['reason']
          )
        );

      case 'getWaitlist':
        return Promise.resolve(!!(params['doctorId'] || params['clinicId']));

      case 'processWaitlist':
        return Promise.resolve(!!(params['doctorId'] && params['clinicId']));

      case 'getWaitlistMetrics':
        return Promise.resolve(!!(params['doctorId'] || params['clinicId']));

      case 'removeFromWaitlist':
        return Promise.resolve(!!params['entryId']);

      case 'updateWaitlistEntry':
        return Promise.resolve(!!(params['entryId'] && params['updateData']));

      default:
        return Promise.resolve(false);
    }
  }

  getRequiredParameters(operation: string): string[] {
    switch (operation) {
      case 'addToWaitlist':
        return ['patientId', 'doctorId', 'clinicId', 'preferredDate', 'reason'];
      case 'getWaitlist':
        return ['doctorId', 'clinicId'];
      case 'processWaitlist':
        return ['doctorId', 'clinicId'];
      case 'getWaitlistMetrics':
        return ['doctorId', 'clinicId'];
      case 'removeFromWaitlist':
        return ['entryId'];
      case 'updateWaitlistEntry':
        return ['entryId', 'updateData'];
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
