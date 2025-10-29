/**
 * Database Infrastructure - Single Unified Service
 *
 * This module provides ONE unified database service for the entire application.
 * All services should use DatabaseService instead of direct PrismaService access.
 *
 * Usage:
 * ```typescript
 * import { DatabaseService } from "../../libs/infrastructure/database";
 *
 * constructor(
 *   private readonly databaseService: DatabaseService,
 * ) {}
 *
 * // Access Prisma client
 * const user = await this.databaseService.getPrismaClient().user.findUnique({...});
 * ```
 */
export * from "./database.module";

// Main database service - HealthcareDatabaseClient as the single service
export { HealthcareDatabaseClient as DatabaseService } from "./clients/healthcare-database.client";

// Type exports for the unified service
export type { DatabaseHealthStatus } from "./interfaces/database-client.interface";
export type {
  UserWithPassword,
  UserCreateData,
  UserSelectResult,
  UserWithRelations,
  UserResponse,
} from "./prisma/user.types";

// Internal exports (not for external use)
// These are only used internally by the DatabaseService
export { HealthcareDatabaseClient } from "./clients/healthcare-database.client";
