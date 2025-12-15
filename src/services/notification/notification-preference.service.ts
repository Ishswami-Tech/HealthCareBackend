import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events';
import { LogType, LogLevel } from '@core/types';
import type {
  CreateNotificationPreferenceDto,
  UpdateNotificationPreferenceDto,
  NotificationPreferenceResponseDto,
  CategoryPreferencesDto,
  QuietHoursDto,
} from '@dtos/notification.dto';

@Injectable()
export class NotificationPreferenceService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => EventService))
    private readonly eventService: EventService
  ) {}

  /**
   * Get user notification preferences
   */
  async getPreferences(userId: string): Promise<NotificationPreferenceResponseDto> {
    const cacheKey = `notification_preferences:${userId}`;

    const preferences = await this.cacheService.cache(
      cacheKey,
      async () => {
        const pref = await this.databaseService.findNotificationPreferenceByUserIdSafe(userId);

        if (!pref) {
          // Return default preferences if not found
          return {
            id: '',
            userId,
            emailEnabled: true,
            smsEnabled: true,
            pushEnabled: true,
            socketEnabled: true,
            whatsappEnabled: false,
            appointmentEnabled: true,
            ehrEnabled: true,
            billingEnabled: true,
            systemEnabled: true,
            quietHours: undefined,
            categoryPreferences: undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }

        return {
          id: pref.id,
          userId: pref.userId,
          emailEnabled: pref.emailEnabled,
          smsEnabled: pref.smsEnabled,
          pushEnabled: pref.pushEnabled,
          socketEnabled: pref.socketEnabled,
          whatsappEnabled: pref.whatsappEnabled,
          appointmentEnabled: pref.appointmentEnabled,
          ehrEnabled: pref.ehrEnabled,
          billingEnabled: pref.billingEnabled,
          systemEnabled: pref.systemEnabled,
          quietHours: pref.quietHoursStart
            ? {
                start: pref.quietHoursStart,
                end: pref.quietHoursEnd || undefined,
                timezone: pref.quietHoursTimezone || 'UTC',
              }
            : undefined,
          categoryPreferences: pref.categoryPreferences
            ? (pref.categoryPreferences as unknown as CategoryPreferencesDto)
            : undefined,
          createdAt: pref.createdAt,
          updatedAt: pref.updatedAt,
        };
      },
      {
        ttl: 3600, // 1 hour
        tags: [`user_preferences:${userId}`],
      }
    );

    return preferences as NotificationPreferenceResponseDto;
  }

  /**
   * Create notification preferences
   */
  async createPreferences(
    data: CreateNotificationPreferenceDto
  ): Promise<NotificationPreferenceResponseDto> {
    // Check if preferences already exist
    const existing = await this.databaseService.findNotificationPreferenceByUserIdSafe(data.userId);
    if (existing) {
      throw new BadRequestException('Notification preferences already exist for this user');
    }

    // Verify user exists
    const user = await this.databaseService.findUserByIdSafe(data.userId);
    if (!user) {
      throw new NotFoundException(`User with ID ${data.userId} not found`);
    }

    const preferences = await this.databaseService.createNotificationPreferenceSafe({
      userId: data.userId,
      emailEnabled: data.emailEnabled ?? true,
      smsEnabled: data.smsEnabled ?? true,
      pushEnabled: data.pushEnabled ?? true,
      socketEnabled: data.socketEnabled ?? true,
      whatsappEnabled: data.whatsappEnabled ?? false,
      appointmentEnabled: data.appointmentEnabled ?? true,
      ehrEnabled: data.ehrEnabled ?? true,
      billingEnabled: data.billingEnabled ?? true,
      systemEnabled: data.systemEnabled ?? true,
      quietHoursStart: data.quietHours?.start || null,
      quietHoursEnd: data.quietHours?.end || null,
      quietHoursTimezone: data.quietHours?.timezone || 'UTC',
      categoryPreferences: data.categoryPreferences
        ? (data.categoryPreferences as unknown as Record<string, unknown>)
        : null,
    });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Notification preferences created',
      'NotificationPreferenceService',
      { userId: data.userId, preferenceId: preferences.id }
    );

    await this.eventService.emit('notification.preference.created', {
      userId: data.userId,
      preferenceId: preferences.id,
    });

    // Invalidate cache
    await this.cacheService.invalidateCacheByTag(`user_preferences:${data.userId}`);

    return {
      id: preferences.id,
      userId: preferences.userId,
      emailEnabled: preferences.emailEnabled,
      smsEnabled: preferences.smsEnabled,
      pushEnabled: preferences.pushEnabled,
      socketEnabled: preferences.socketEnabled,
      whatsappEnabled: preferences.whatsappEnabled,
      appointmentEnabled: preferences.appointmentEnabled,
      ehrEnabled: preferences.ehrEnabled,
      billingEnabled: preferences.billingEnabled,
      systemEnabled: preferences.systemEnabled,
      ...(preferences.quietHoursStart && {
        quietHours: {
          start: preferences.quietHoursStart,
          end: preferences.quietHoursEnd || undefined,
          timezone: preferences.quietHoursTimezone || 'UTC',
        } as QuietHoursDto,
      }),
      ...(preferences.categoryPreferences && {
        categoryPreferences: preferences.categoryPreferences as unknown as CategoryPreferencesDto,
      }),
      createdAt: preferences.createdAt,
      updatedAt: preferences.updatedAt,
    };
  }

  /**
   * Update notification preferences
   */
  async updatePreferences(
    userId: string,
    data: UpdateNotificationPreferenceDto
  ): Promise<NotificationPreferenceResponseDto> {
    const existing = await this.databaseService.findNotificationPreferenceByUserIdSafe(userId);
    if (!existing) {
      throw new NotFoundException('Notification preferences not found for this user');
    }

    const updateData: {
      emailEnabled?: boolean;
      smsEnabled?: boolean;
      pushEnabled?: boolean;
      socketEnabled?: boolean;
      whatsappEnabled?: boolean;
      appointmentEnabled?: boolean;
      ehrEnabled?: boolean;
      billingEnabled?: boolean;
      systemEnabled?: boolean;
      quietHoursStart?: string | null;
      quietHoursEnd?: string | null;
      quietHoursTimezone?: string | null;
      categoryPreferences?: Record<string, unknown> | null;
    } = {};

    if (data.emailEnabled !== undefined) updateData.emailEnabled = data.emailEnabled;
    if (data.smsEnabled !== undefined) updateData.smsEnabled = data.smsEnabled;
    if (data.pushEnabled !== undefined) updateData.pushEnabled = data.pushEnabled;
    if (data.socketEnabled !== undefined) updateData.socketEnabled = data.socketEnabled;
    if (data.whatsappEnabled !== undefined) updateData.whatsappEnabled = data.whatsappEnabled;
    if (data.appointmentEnabled !== undefined)
      updateData.appointmentEnabled = data.appointmentEnabled;
    if (data.ehrEnabled !== undefined) updateData.ehrEnabled = data.ehrEnabled;
    if (data.billingEnabled !== undefined) updateData.billingEnabled = data.billingEnabled;
    if (data.systemEnabled !== undefined) updateData.systemEnabled = data.systemEnabled;

    if (data.quietHours) {
      updateData.quietHoursStart = data.quietHours.start || null;
      updateData.quietHoursEnd = data.quietHours.end || null;
      updateData.quietHoursTimezone = data.quietHours.timezone || 'UTC';
    }

    if (data.categoryPreferences) {
      updateData.categoryPreferences = data.categoryPreferences as unknown as Record<
        string,
        unknown
      >;
    }

    const preferences = await this.databaseService.updateNotificationPreferenceSafe(
      existing.id,
      updateData
    );

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Notification preferences updated',
      'NotificationPreferenceService',
      { userId, preferenceId: preferences.id }
    );

    await this.eventService.emit('notification.preference.updated', {
      userId,
      preferenceId: preferences.id,
    });

    // Invalidate cache
    await this.cacheService.invalidateCacheByTag(`user_preferences:${userId}`);

    return {
      id: preferences.id,
      userId: preferences.userId,
      emailEnabled: preferences.emailEnabled,
      smsEnabled: preferences.smsEnabled,
      pushEnabled: preferences.pushEnabled,
      socketEnabled: preferences.socketEnabled,
      whatsappEnabled: preferences.whatsappEnabled,
      appointmentEnabled: preferences.appointmentEnabled,
      ehrEnabled: preferences.ehrEnabled,
      billingEnabled: preferences.billingEnabled,
      systemEnabled: preferences.systemEnabled,
      ...(preferences.quietHoursStart && {
        quietHours: {
          start: preferences.quietHoursStart,
          end: preferences.quietHoursEnd || undefined,
          timezone: preferences.quietHoursTimezone || 'UTC',
        } as QuietHoursDto,
      }),
      ...(preferences.categoryPreferences && {
        categoryPreferences: preferences.categoryPreferences as unknown as CategoryPreferencesDto,
      }),
      createdAt: preferences.createdAt,
      updatedAt: preferences.updatedAt,
    };
  }

  /**
   * Delete notification preferences (reset to defaults)
   */
  async deletePreferences(userId: string): Promise<void> {
    const existing = await this.databaseService.findNotificationPreferenceByUserIdSafe(userId);
    if (!existing) {
      throw new NotFoundException('Notification preferences not found for this user');
    }

    await this.databaseService.deleteNotificationPreferenceSafe(existing.id);

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Notification preferences deleted',
      'NotificationPreferenceService',
      { userId, preferenceId: existing.id }
    );

    await this.eventService.emit('notification.preference.deleted', {
      userId,
      preferenceId: existing.id,
    });

    // Invalidate cache
    await this.cacheService.invalidateCacheByTag(`user_preferences:${userId}`);
  }
}
