import { Injectable } from '@nestjs/common';
import { LoggingService } from '../../../shared/logging/logging.service';
import { LogLevel, LogType } from '../../../shared/logging/types/logging.types';

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
  async logError(error: any, service: string, operation: string, metadata: any) {
    await this.loggingService.log(
      LogType.ERROR,
      LogLevel.ERROR,
      `Failed to ${operation}`,
      service,
      { error: error.message, ...metadata }
    );
  }

  /**
   * Standardized success logging
   * @param message The success message
   * @param service The service name
   * @param operation The operation being performed
   * @param metadata Additional metadata
   */
  async logSuccess(message: string, service: string, operation: string, metadata: any) {
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      message,
      service,
      metadata
    );
  }
} 