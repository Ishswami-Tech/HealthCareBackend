import { Prisma } from '@prisma/client';

/**
 * Middleware to handle connection management and query optimization
 */
export const connectionManagementMiddleware: any = async (
  params: any,
  next: (params: any) => Promise<any>
) => {
  const startTime = Date.now();
  const queryStartTime = process.hrtime.bigint();

  try {
    // Add query logging for debugging
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Prisma Query] ${params.model}.${params.action}`, {
        args: JSON.stringify(params.args, null, 2),
        timestamp: new Date().toISOString(),
      });
    }

    // Add query tags for better monitoring
    if (params.action === 'queryRaw' || params.action === 'executeRaw') {
      params.args[0] = `/* tenant_id:${params.args[1]?.tenant_id ?? 'unknown'} */ ${params.args[0]}`;
    }

    // Add tenant context if available
    if (params.runInTransaction) {
      return await next(params);
    }

    // Add tenant context to the query if tenantId is set
    if (params.model && params.action) {
      // Add tenant context for multi-tenant models
      if (['User', 'Appointment', 'Doctor', 'Patient', 'Clinic', 'ClinicLocation'].includes(params.model)) {
        // Tenant context is handled by the PrismaService
        return await next(params);
      }
    }

    // Execute the query
    const result = await next(params);

    // Log query performance
    const queryEndTime = process.hrtime.bigint();
    const queryDuration = Number(queryEndTime - queryStartTime) / 1000000; // Convert to milliseconds

    if (queryDuration > 100) { // Log slow queries (>100ms)
      console.warn(`[Slow Query] ${params.model}.${params.action} took ${queryDuration.toFixed(2)}ms`);
    }

    return result;
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;

    // Log error with context
    console.error(`[Prisma Error] ${params.model}.${params.action} failed after ${duration}ms:`, {
      error: error.message,
      args: params.args,
      timestamp: new Date().toISOString(),
    });

    // Handle specific database errors
    if (error instanceof Error && error.name === 'PrismaClientKnownRequestError') {
      switch ((error as any).code) {
        case 'P2024': // Connection pool timeout
          console.error('Connection pool timeout, consider increasing pool size');
          break;
        case 'P2028': // Transaction timeout
          console.error('Transaction timeout, check for long-running transactions');
          break;
        case 'P2025': // Record not found
          console.error('Record not found error');
          break;
      }
    }

    // Handle Prisma errors
    if (error instanceof Error && error.name === 'PrismaClientKnownRequestError') {
      // Log the error and rethrow
      console.error('Prisma middleware error:', error);
    }
    throw error;
  }
}; 