/**
 * Framework Adapter Module Exports
 *
 * @module Framework
 * @description Framework abstraction layer exports
 */

export {
  IFrameworkAdapter,
  IFastifyFrameworkAdapter,
  FrameworkAdapterOptions,
} from '@core/types/framework.types';
export { FastifyFrameworkAdapter, createFrameworkAdapter } from './adapters/fastify.adapter';

// Framework Wrappers
export {
  ServiceContainer,
  MiddlewareManager,
  ApplicationLifecycleManager,
  ServerConfigurator,
  BootstrapOrchestrator,
} from './wrappers';

// Manual Routes Manager
export { registerManualRoutes } from './manual-routes.manager';

// Framework Extensions
// Note: FastifyExtensions was removed - use SecurityConfigService for security middleware
// Extensions module is kept for future framework-specific extensions
