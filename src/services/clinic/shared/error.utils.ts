import { Injectable } from "@nestjs/common";
// import { LoggingService } from "src/libs/infrastructure/logging/logging.service";
// import {
//   LogLevel,
//   LogType,
// } from "src/libs/infrastructure/logging/types/logging.types";

// Define types locally since the import paths are not working
enum LogLevel {
  ERROR = "error",
  WARN = "warn",
  INFO = "info",
  DEBUG = "debug",
}

enum LogType {
  ERROR = "error",
  SYSTEM = "system",
  APPOINTMENT = "appointment",
}

interface LoggingService {
  log(
    type: LogType,
    level: LogLevel,
    message: string,
    service: string,
    metadata: unknown,
  ): Promise<void>;
}

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
  async logError(
    error: unknown,
    service: string,
    operation: string,
    metadata: unknown,
  ) {
    await this.loggingService.log(
      LogType.ERROR,
      LogLevel.ERROR,
      `Failed to ${operation}`,
      service,
      {
        error: (error as Error).message,
        ...(metadata as Record<string, unknown>),
      },
    );
  }

  /**
   * Standardized success logging
   * @param message The success message
   * @param service The service name
   * @param operation The operation being performed
   * @param metadata Additional metadata
   */
  async logSuccess(
    message: string,
    service: string,
    operation: string,
    metadata: unknown,
  ) {
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      message,
      service,
      metadata,
    );
  }
}
