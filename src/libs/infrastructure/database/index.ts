// Database infrastructure exports
export * from './database.module';
export * from './clients/healthcare-database.client';
export * from './database-metrics.service';
export * from './connection-pool.manager';
export * from './query-optimizer.service';
export * from './clinic-isolation.service';

// Prisma exports
export * from './prisma/prisma.service';
export * from './prisma/prisma.module';
export * from './prisma/prisma.types';

// Repository exports
export { BaseRepository } from './repositories/base.repository';
export * from './repositories/user.repository';
export * from './repositories/simple-patient.repository';

// Interface exports
export * from './interfaces/database-client.interface';

// Type exports
export * from './types/repository-result';

// Config exports
export * from './config/healthcare.config';
