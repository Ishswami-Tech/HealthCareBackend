/**
 * Database Infrastructure - Single Unified Service
 *
 * SINGLE ENTRY POINT: Only DatabaseService is the public interface.
 * All infrastructure components are internal and not exported.
 *
 * IMPORTANT: This is the ONLY module and client you should import and use.
 * All database operations MUST go through DatabaseService which provides:
 * - Connection pooling and read replicas
 * - Query caching and optimization
 * - Metrics tracking and monitoring
 * - HIPAA compliance and audit logging
 * - Multi-tenant clinic isolation
 * - All optimization layers automatically applied
 *
 * Usage:
 * ```typescript
 * // ✅ CORRECT: Use DatabaseService (ONLY public interface)
 * import { DatabaseService } from "@infrastructure/database";
 *
 * constructor(
 *   private readonly databaseService: DatabaseService,
 * ) {}
 *
 * // Use optimized read operations with caching and query optimization
 * const user = await this.databaseService.executeHealthcareRead(async (client) => {
 *   return await client['user'].findUnique({ where: { id: userId } });
 * });
 *
 * // Use optimized write operations with audit logging
 * const created = await this.databaseService.executeHealthcareWrite(async (client) => {
 *   return await client['user'].create({ data: userData });
 * }, auditInfo);
 *
 * // Use clinic context for multi-tenant operations
 * const clinicData = await this.databaseService.executeWithClinicContext(clinicId, async (client) => {
 *   return await client['patient'].findMany({ where: { clinicId } });
 * });
 * ```
 *
 * NOTE: All database infrastructure components are INTERNAL.
 * External services should ONLY use DatabaseService.
 */
export { DatabaseModule } from './database.module';

// SINGLE UNIFIED DATABASE SERVICE - This is the ONLY public interface
// All database operations MUST go through this service with full optimization layers
// DO NOT import or use any other database components directly

// ONLY PUBLIC EXPORT: DatabaseService
// Use separate export file to avoid circular dependency issues
export { DatabaseService } from './database-service.export';

// Type exports for the unified service (re-export from @core/types)
export type {
  DatabaseHealthStatus,
  IDatabaseClient,
  IHealthcareDatabaseClient,
} from '@core/types/database.types';

// Re-export types from centralized locations
export type {
  UserWithPassword,
  UserCreateData,
  UserSelectResult,
  UserWithRelations,
  UserResponse,
  UserWithProfile,
  UserSearchOptions,
} from '@core/types/user.types';
export type {
  RbacRoleEntity,
  RolePermissionEntity,
  UserRoleEntity,
  PatientWithUser,
} from '@core/types/database.types';
// PermissionEntity comes from rbac.types (matches Prisma schema)
export type { PermissionEntity } from '@core/types/rbac.types';

// NOTE: Repositories (UserRepository, SimplePatientRepository) are INTERNAL infrastructure components
// They are NOT exported. Use DatabaseService directly for all database operations.
// Repositories are only used internally by DatabaseService for optimization layers.
