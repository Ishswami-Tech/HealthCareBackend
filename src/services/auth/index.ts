// Export main auth modules
export { AuthModule } from './auth.module';
// Export controllers
export { ClinicAuthController } from './controllers/clinic-auth.controller';

// Export core authentication services
export { SessionManagementService } from '../../libs/core/session/session-management.service';

// =============================================
// PLUGIN-BASED ARCHITECTURE EXPORTS
// =============================================

// Core plugin architecture
export { BaseAuthService } from './core/base-auth.service';
export { PluginManagerService } from './core/plugin-manager.service';
export { 
  IAuthPlugin,
  AuthPluginDomain,
  AuthPluginContext,
  AuthPluginCapabilities,
  DomainValidationResult,
  LoginRequest,
  RegisterRequest,
  OTPRequest,
  PasswordResetRequest,
  MagicLinkRequest,
  AuthPluginMetadata,
  IAuthPluginFactory
} from './core/auth-plugin.interface';

// Domain-specific plugins
export { ClinicAuthPlugin } from './plugins/clinic-auth.plugin';
export { SharedAuthPlugin } from './plugins/shared-auth.plugin';

// Implementation services
export { ClinicAuthService } from './implementations/clinic-auth.service';



// =============================================
// SCALABILITY & PERFORMANCE EXPORTS
// =============================================

// Rate limiting and security
// export { RateLimitModule } from '@security/rate-limit';
export { RbacModule } from '../../libs/core/rbac/rbac.module';
export { RbacService } from '../../libs/core/rbac/rbac.service';
export { RequireResourcePermission } from '../../libs/core/rbac/rbac.decorators';
export { RbacGuard } from '../../libs/core/rbac/rbac.guard';

// Caching and session management
export { CacheModule } from '../../libs/infrastructure/cache';
export { LoggingServiceModule } from '../../libs/infrastructure/logging';

// Database and resilience
export { DatabaseModule } from '../../libs/infrastructure/database';
// export { CircuitBreakerService } from '../../libs/core/resilience';

// =============================================
// TYPE EXPORTS FOR FRONTEND INTEGRATION
// =============================================

// Auth response types
// Note: These types may need to be properly exported from their respective modules
// export type { AuthTokens, TokenPayload } from './core/base-auth.service';
// export type { SessionData } from './services/session.service';

// Plugin types
export type { PluginMetrics, PluginHealthStatus } from './core/plugin-manager.service'; 