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
import { ClinicQueuePlugin } from '@services/appointments/plugins/queue/clinic-queue.plugin';
import { ClinicNotificationPlugin } from '@services/appointments/plugins/notifications/clinic-notification.plugin';
import { ClinicReminderPlugin } from '@services/appointments/plugins/reminders/clinic-reminder.plugin';
import { ClinicAnalyticsPlugin } from '@services/appointments/plugins/analytics/clinic-analytics.plugin';
import { ClinicFollowUpPlugin } from '@services/appointments/plugins/followup/clinic-followup.plugin';
import { ClinicLocationPlugin } from '@services/appointments/plugins/location/clinic-location.plugin';
import { ClinicConfirmationPlugin } from '@services/appointments/plugins/confirmation/clinic-confirmation.plugin';
import { ClinicCheckInPlugin } from '@services/appointments/plugins/checkin/clinic-checkin.plugin';
import { ClinicPaymentPlugin } from '@services/appointments/plugins/payment/clinic-payment.plugin';
import { ClinicVideoPlugin } from '@services/appointments/plugins/video/clinic-video.plugin';
import { AppointmentCommunicationsPlugin } from '@services/appointments/communications/appointment-communications.plugin';
import { ClinicTemplatePlugin } from '@services/appointments/plugins/templates/clinic-template.plugin';
import { ClinicWaitlistPlugin } from '@services/appointments/plugins/waitlist/clinic-waitlist.plugin';
import { ClinicResourcePlugin } from '@services/appointments/plugins/resources/clinic-resource.plugin';
import { ClinicEligibilityPlugin } from '@services/appointments/plugins/eligibility/clinic-eligibility.plugin';

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
