// Database infrastructure exports
export * from "./database.module";
export * from "./database-client.factory";
export * from "./database-metrics.service";
export * from "./connection-pool.manager";
export * from "./query-optimizer.service";
export * from "./clinic-isolation.service";

// Client exports
export * from "./clients/healthcare-database.client";

// Interface exports
export * from "./interfaces/database-client.interface";

// Prisma exports
export * from "./prisma/prisma.service";

// Type aliases for backwards compatibility (following DRY principle)
export { HealthcareDatabaseClient as DatabaseClient } from "./clients/healthcare-database.client";
export type { DatabaseHealthStatus } from "./interfaces/database-client.interface";

// Repository exports - commented out until implemented
// export * from './repositories/base.repository';

// Config exports - commented out until implemented
// export * from './config/database.config';

// Interface exports - commented out until implemented
// export * from './interfaces/database.interface';
// export * from './interfaces/connection.interface';

// Type exports - commented out until implemented
// export * from './types/database.types';
// export * from './types/connection.types';
