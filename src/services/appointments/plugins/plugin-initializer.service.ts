/**
 * Appointment Plugin Initializer Service
 *
 * Automatically registers and initializes all appointment plugins with the
 * centralized EnterprisePluginRegistry and EnterprisePluginManager.
 *
 * @module PluginInitializer
 * @description Service for initializing appointment plugins with the generic plugin system
 */

// External imports
import { Injectable, OnModuleInit } from '@nestjs/common';

// Internal imports - Core
import { EnterprisePluginRegistry, EnterprisePluginManager } from '@core/plugin-interface';
import { LoggingService } from '@infrastructure/logging';
import type { BasePlugin, PluginContext, PluginInfo } from '@core/types';
import { LogType, LogLevel } from '@core/types';

// Internal imports - Plugins
import { ClinicQueuePlugin } from './queue/clinic-queue.plugin';
import { ClinicNotificationPlugin } from './notifications/clinic-notification.plugin';
import { ClinicReminderPlugin } from './reminders/clinic-reminder.plugin';
import { ClinicAnalyticsPlugin } from './analytics/clinic-analytics.plugin';
import { ClinicFollowUpPlugin } from './followup/clinic-followup.plugin';
import { ClinicLocationPlugin } from './location/clinic-location.plugin';
import { ClinicConfirmationPlugin } from './confirmation/clinic-confirmation.plugin';
import { ClinicCheckInPlugin } from './checkin/clinic-checkin.plugin';
import { ClinicPaymentPlugin } from './payment/clinic-payment.plugin';
import { ClinicVideoPlugin } from './video/clinic-video.plugin';
import { AppointmentCommunicationsPlugin } from '../communications/appointment-communications.plugin';
import { ClinicTemplatePlugin } from './templates/clinic-template.plugin';
import { ClinicWaitlistPlugin } from './waitlist/clinic-waitlist.plugin';
import { ClinicResourcePlugin } from './resources/clinic-resource.plugin';
import { ClinicEligibilityPlugin } from './eligibility/clinic-eligibility.plugin';

/**
 * Appointment Plugin Initializer
 *
 * Automatically registers all appointment plugins with the centralized plugin system
 * and initializes them on module startup.
 */
@Injectable()
export class AppointmentPluginInitializer implements OnModuleInit {
  constructor(
    private readonly registry: EnterprisePluginRegistry,
    private readonly pluginManager: EnterprisePluginManager,
    private readonly loggingService: LoggingService,
    // Inject all plugins
    private readonly clinicQueuePlugin: ClinicQueuePlugin,
    private readonly clinicNotificationPlugin: ClinicNotificationPlugin,
    private readonly clinicReminderPlugin: ClinicReminderPlugin,
    private readonly clinicAnalyticsPlugin: ClinicAnalyticsPlugin,
    private readonly clinicFollowUpPlugin: ClinicFollowUpPlugin,
    private readonly clinicLocationPlugin: ClinicLocationPlugin,
    private readonly clinicConfirmationPlugin: ClinicConfirmationPlugin,
    private readonly clinicCheckInPlugin: ClinicCheckInPlugin,
    private readonly clinicPaymentPlugin: ClinicPaymentPlugin,
    private readonly clinicVideoPlugin: ClinicVideoPlugin,
    private readonly appointmentCommunicationsPlugin: AppointmentCommunicationsPlugin,
    private readonly clinicTemplatePlugin: ClinicTemplatePlugin,
    private readonly clinicWaitlistPlugin: ClinicWaitlistPlugin,
    private readonly clinicResourcePlugin: ClinicResourcePlugin,
    private readonly clinicEligibilityPlugin: ClinicEligibilityPlugin
  ) {}

  /**
   * Initialize all plugins on module init
   */
  async onModuleInit(): Promise<void> {
    const startTime = Date.now();

    try {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Starting appointment plugin initialization',
        'AppointmentPluginInitializer',
        {}
      );

      // Get all plugins
      const plugins = this.getAllPlugins();

      // Register all plugins
      for (const plugin of plugins) {
        try {
          await this.registry.register(plugin);
          this.registerPluginInfo(plugin);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            `Failed to register plugin: ${plugin.name}`,
            'AppointmentPluginInitializer',
            { pluginName: plugin.name, error: errorMessage }
          );
        }
      }

      // Initialize all plugins with default context
      const context: PluginContext = {
        metadata: {
          service: 'appointments',
          initializedAt: new Date().toISOString(),
        },
      };

      await this.pluginManager.initializePlugins(context);

      const duration = Date.now() - startTime;
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Appointment plugins initialized successfully',
        'AppointmentPluginInitializer',
        {
          pluginCount: plugins.length,
          duration,
        }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const duration = Date.now() - startTime;

      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to initialize appointment plugins',
        'AppointmentPluginInitializer',
        {
          error: errorMessage,
          duration,
        }
      );
    }
  }

  /**
   * Get all appointment plugins
   *
   * @private
   */
  private getAllPlugins(): BasePlugin[] {
    return [
      this.clinicQueuePlugin,
      this.clinicNotificationPlugin,
      this.clinicReminderPlugin,
      this.clinicAnalyticsPlugin,
      this.clinicFollowUpPlugin,
      this.clinicLocationPlugin,
      this.clinicConfirmationPlugin,
      this.clinicCheckInPlugin,
      this.clinicPaymentPlugin,
      this.clinicVideoPlugin,
      this.appointmentCommunicationsPlugin,
      this.clinicTemplatePlugin,
      this.clinicWaitlistPlugin,
      this.clinicResourcePlugin,
      this.clinicEligibilityPlugin,
    ];
  }

  /**
   * Register plugin info with the registry
   *
   * @private
   */
  private registerPluginInfo(plugin: BasePlugin): void {
    // Extract primary feature from plugin features
    const primaryFeature = plugin.features[0] || 'unknown';

    const pluginInfo: PluginInfo = {
      name: plugin.name,
      version: plugin.version,
      domain: 'healthcare',
      feature: primaryFeature,
      isActive: true,
    };

    this.registry.registerPluginInfo(pluginInfo);
  }
}
