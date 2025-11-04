/**
 * Session Module Exports
 * @module Session
 * @description Exports all session-related services, interfaces, and utilities
 * for comprehensive session management in healthcare applications.
 * @example
 * ```typescript
 * import {
 *   SessionManagementService,
 *   SessionModule,
 *   type SessionData,
 *   type CreateSessionDto
 * } from "@core/session";
 *
 * const sessionService = new SessionManagementService();
 * ```
 */

export { SessionManagementService } from './session-management.service';
export { SessionModule } from './session.module';
// All types are now in @core/types/session.types.ts
export type {
  SessionData,
  SessionConfig,
  CreateSessionDto,
  SessionSummary,
  RedisSessionData,
  LockoutStatus,
} from '@core/types/session.types';
