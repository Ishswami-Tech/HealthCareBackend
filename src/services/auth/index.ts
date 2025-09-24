// Export main auth modules
export { AuthModule } from "./auth.module";

// Export core authentication services
export { SessionManagementService } from "../../libs/core/session/session-management.service";

// Implementation services
export { AuthService } from "./auth.service";

// =============================================
// SCALABILITY & PERFORMANCE EXPORTS
// =============================================

// Rate limiting and security
// export { RateLimitModule } from '@security/rate-limit';
export { RbacModule } from "../../libs/core/rbac/rbac.module";
export { RbacService } from "../../libs/core/rbac/rbac.service";
export { RequireResourcePermission } from "../../libs/core/rbac/rbac.decorators";
export { RbacGuard } from "../../libs/core/rbac/rbac.guard";

// Caching and session management
export { LoggingModule } from "../../libs/infrastructure/logging";

// Database and resilience
export { DatabaseModule } from "../../libs/infrastructure/database";
// export { CircuitBreakerService } from '../../libs/core/resilience';

// =============================================
// TYPE EXPORTS FOR FRONTEND INTEGRATION
// =============================================

// Auth response types
// Note: These types may need to be properly exported from their respective modules
// export type { AuthTokens, TokenPayload } from './core/base-auth.service';
// export type { SessionData } from './services/session.service';
