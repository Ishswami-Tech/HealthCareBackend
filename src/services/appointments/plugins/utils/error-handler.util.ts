import { Logger } from '@nestjs/common';

export interface ErrorContext {
  pluginName: string;
  operation: string;
  domain: string;
  data?: any;
  userId?: string;
}

export class PluginErrorHandler {
  private static readonly logger = new Logger('PluginErrorHandler');

  static handleError(error: unknown, context: ErrorContext): never {
    const errorMessage = error instanceof Error ? (error as Error).message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    
    this.logger.error(
      `Plugin error in ${context.pluginName}: ${errorMessage}`,
      {
        ...context,
        error: errorStack,
        timestamp: new Date().toISOString()
      }
    );

    // Create a standardized error response
    const standardizedError = new Error(
      `Plugin operation failed: ${context.operation} in ${context.pluginName} for domain ${context.domain}`
    );
    
    // Preserve original error information
    (standardizedError as any).originalError = error;
    (standardizedError as any).context = context;
    
    throw standardizedError;
  }

  static validateRequiredFields(data: any, requiredFields: string[], context: ErrorContext): void {
    const missingFields = requiredFields.filter(field => data[field] === undefined);
    
    if (missingFields.length > 0) {
      const error = new Error(`Missing required fields: ${missingFields.join(', ')}`);
      this.handleError(error, context);
    }
  }

  static validateOperation(operation: string, validOperations: string[], context: ErrorContext): void {
    if (!validOperations.includes(operation)) {
      const error = new Error(`Invalid operation: ${operation}. Valid operations: ${validOperations.join(', ')}`);
      this.handleError(error, context);
    }
  }

  static createErrorResponse(error: unknown, context: ErrorContext): any {
    const errorMessage = error instanceof Error ? (error as Error).message : String(error);
    
    return {
      success: false,
      error: errorMessage,
      pluginName: context.pluginName,
      operation: context.operation,
      domain: context.domain,
      timestamp: new Date().toISOString()
    };
  }
}
