import { Prisma } from '@prisma/client';

/**
 * Middleware to handle connection management and query optimization
 */
export const connectionManagementMiddleware: Prisma.Middleware = async (
  params,
  next,
) => {
  const startTime = Date.now();
  
  try {
    // Add query tags for better monitoring
    if (params.action === 'queryRaw' || params.action === 'executeRaw') {
      params.args[0] = `/* tenant_id:${params.args[1]?.tenant_id ?? 'unknown'} */ ${params.args[0]}`;
    }

    // Execute the query
    const result = await next(params);

    // Log slow queries (over 1 second)
    const duration = Date.now() - startTime;
    if (duration > 1000) {
      console.warn(`Slow query detected (${duration}ms):`, {
        model: params.model,
        action: params.action,
        args: params.args,
      });
    }

    return result;
  } catch (error) {
    // Handle specific database errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
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
    throw error;
  }
}; 