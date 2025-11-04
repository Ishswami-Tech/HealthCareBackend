import { Injectable } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';

@Injectable()
export class ClinicErrorService {
  constructor(private readonly loggingService: LoggingService) {}

  /**
   * Standardized error logging
   * @param error The error object
   * @param service The service name
   * @param operation The operation being performed
   * @param metadata Additional metadata
   */
  async logError(error: unknown, service: string, operation: string, metadata: unknown) {
    await this.loggingService.log(
      LogType.ERROR,
      LogLevel.ERROR,
      `Failed to ${operation}`,
      service,
      {
        error: (error as Error).message,
        ...(metadata as Record<string, unknown>),
      } as Record<string, unknown>
    );
  }

  /**
   * Standardized success logging
   * @param message The success message
   * @param service The service name
   * @param operation The operation being performed
   * @param metadata Additional metadata
   */
  async logSuccess(message: string, service: string, operation: string, metadata: unknown) {
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      message,
      service,
      metadata as Record<string, unknown> | undefined
    );
  }
}
