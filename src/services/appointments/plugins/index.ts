// Error classes from plugin interface (if needed)
// Note: Types are imported from @core/types, not from plugin-interface
// Note: Generic EnterprisePluginManager and EnterprisePluginRegistry are in @core/plugin-interface

// Plugin Controller
export * from './plugin.controller';

// Plugin Initializer
export * from './plugin-initializer.service';

// Plugin Configuration
export { PluginConfigService } from './config/plugin-config.service';
export type { PluginConfig, PluginConfigMap } from './config/plugin-config.service';

// Plugin Health Monitoring
export { PluginHealthService } from './health/plugin-health.service';
export type { PluginHealthMetrics, PluginHealthSummary } from './health/plugin-health.service';

// Base Plugin
export * from './base/base-plugin.service';

// Clinic Plugins (Healthcare Focus)

export * from './location/clinic-location.plugin';
export * from './confirmation/clinic-confirmation.plugin';
export * from './checkin/clinic-checkin.plugin';
export * from './payment/clinic-payment.plugin';
export * from './video/clinic-video.plugin';
export * from './notifications/clinic-notification.plugin';
export * from './reminders/clinic-reminder.plugin';
export * from './analytics/clinic-analytics.plugin';
export * from './followup/clinic-followup.plugin';
export * from './templates/clinic-template.plugin';
export * from './waitlist/clinic-waitlist.plugin';
export * from './resources/clinic-resource.plugin';
export * from './eligibility/clinic-eligibility.plugin';

// Communications Integration (uses libs/communication)
export * from '../communications';

// Service Dependencies
// VideoService is now in @services/video - use VideoModule instead
export * from './payment/payment.service';
export { AppointmentQueueService } from '@infrastructure/queue';
export * from './location/appointment-location.service';
export * from './confirmation/appointment-confirmation.service';
export * from './checkin/check-in.service';
export * from './notifications/appointment-notification.service';
export * from './reminders/appointment-reminder.service';
export * from './analytics/appointment-analytics.service';
export * from './followup/appointment-followup.service';
export * from './templates/appointment-template.service';
export * from './waitlist/appointment-waitlist.service';
export * from './resources/appointment-resource.service';
export * from './eligibility/clinic-eligibility.plugin';
export * from './eligibility/appointment-eligibility.service';
