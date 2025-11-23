/**
 * Query Repositories
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

export { BaseRepository } from './base.repository';
export { UserRepository } from './user.repository';
export { SimplePatientRepository } from './simple-patient.repository';

export type { IBaseRepository } from './base.repository';
export type {
  RepositoryResult,
  QueryOptions,
  PaginatedResult,
  RepositoryContext,
} from './base.repository';
