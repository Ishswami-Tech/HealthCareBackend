import {
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";

export interface ErrorContext {
  pluginName: string;
  operation: string;
  domain: string;
  data?: unknown;
  userId?: string;
}

export class PluginErrorHandler {
  private static readonly logger = new Logger("PluginErrorHandler");

  static handleError(error: unknown, context: ErrorContext): never {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "";

    this.logger.error(
      `Plugin error in ${context.pluginName}: ${errorMessage}`,
      {
        ...context,
        error: errorStack,
        timestamp: new Date().toISOString(),
      },
    );

    // Create a standardized error response using NestJS exception
    const standardizedMessage = `Plugin operation failed: ${context.operation} in ${context.pluginName} for domain ${context.domain}`;

    // Use appropriate NestJS exception based on error type
    if (error instanceof BadRequestException) {
      throw error;
    } else {
      throw new InternalServerErrorException(standardizedMessage);
    }
  }

  static validateRequiredFields(
    data: unknown,
    requiredFields: string[],
    _context: ErrorContext,
  ): void {
    const missingFields = requiredFields.filter(
      (field) => (data as Record<string, unknown>)[field] === undefined,
    );

    if (missingFields.length > 0) {
      throw new BadRequestException(
        `Missing required fields: ${missingFields.join(", ")}`,
      );
    }
  }

  static validateOperation(
    operation: string,
    validOperations: string[],
    _context: ErrorContext,
  ): void {
    if (!validOperations.includes(operation)) {
      throw new BadRequestException(
        `Invalid operation: ${operation}. Valid operations: ${validOperations.join(", ")}`,
      );
    }
  }

  static createErrorResponse(error: unknown, context: ErrorContext): unknown {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      error: errorMessage,
      pluginName: context.pluginName,
      operation: context.operation,
      domain: context.domain,
      timestamp: new Date().toISOString(),
    };
  }
}
