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

export { SessionManagementService } from "./session-management.service";
export { SessionModule } from "./session.module";
export type {
  SessionData,
  SessionConfig,
  CreateSessionDto,
  SessionSummary,
} from "./session-management.service";
