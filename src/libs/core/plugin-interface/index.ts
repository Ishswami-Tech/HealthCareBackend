/**
 * Enterprise Plugin Interface Library
 *
 * Provides unified plugin system for all healthcare platform services.
 * Supports domain-specific plugins with enterprise-grade features.
 *
 * NOTE: All types are in @core/types. Import types from @core/types directly.
 * This module exports error class implementations and generic registry/manager implementations.
 */

// Error classes (implementations)
export { PluginError, PluginTimeoutError, PluginValidationError } from './plugin.interface';

// Generic implementations
export { EnterprisePluginRegistry } from './plugin.registry';
export { EnterprisePluginManager } from './plugin.manager';
