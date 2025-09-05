// Enterprise Plugin System (unified)
export * from '../../../libs/core/plugin-interface';

// Enterprise Plugin Manager Integration
export * from './enterprise-plugin-manager';

// Plugin Controller
export * from './plugin.controller';

// Plugin Configuration
export { PluginConfigService } from './config/plugin-config.service';
export type { PluginConfig, PluginConfigMap } from './config/plugin-config.service';

// Plugin Health Monitoring
export { PluginHealthService } from './health/plugin-health.service';
export type { PluginHealthMetrics, PluginHealthSummary } from './health/plugin-health.service';

// Base Plugin
export * from './base/base-plugin.service';

// Clinic Plugins (Healthcare Focus)
export * from './queue/clinic-queue.plugin';
export * from './location/clinic-location.plugin';
export * from './confirmation/clinic-confirmation.plugin';
export * from './checkin/clinic-checkin.plugin';
export * from './payment/clinic-payment.plugin';
export * from './video/clinic-video.plugin';

// Communications Integration (uses libs/communication)
export * from '../communications';

// Service Dependencies
export * from './video/video.service';
export * from './payment/payment.service';
