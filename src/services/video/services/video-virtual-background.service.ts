/**
 * Video Virtual Background Service
 * @class VideoVirtualBackgroundService
 * @description Virtual background management for video consultations
 * Supports blur background, custom backgrounds, privacy protection, and professional appearance
 * Note: Actual background processing is done client-side via OpenVidu SDK
 * This service manages background settings and preferences
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { SocketService } from '@communication/channels/socket/socket.service';
import { EventService } from '@infrastructure/events';
import { StaticAssetService, AssetType } from '@infrastructure/storage';
import { LogType, LogLevel, EventCategory, EventPriority } from '@core/types';

import type { VirtualBackgroundSettingsDto } from '@dtos/video.dto';

export type VirtualBackgroundSettings = VirtualBackgroundSettingsDto;

export interface BackgroundPreset {
  id: string;
  name: string;
  type: 'blur' | 'image';
  imageUrl?: string;
  blurIntensity?: number;
  isDefault: boolean;
}

@Injectable()
export class VideoVirtualBackgroundService {
  private readonly BACKGROUND_CACHE_TTL = 3600; // 1 hour
  private readonly DEFAULT_PRESETS: BackgroundPreset[] = [
    {
      id: 'blur-light',
      name: 'Light Blur',
      type: 'blur',
      blurIntensity: 30,
      isDefault: true,
    },
    {
      id: 'blur-medium',
      name: 'Medium Blur',
      type: 'blur',
      blurIntensity: 50,
      isDefault: false,
    },
    {
      id: 'blur-strong',
      name: 'Strong Blur',
      type: 'blur',
      blurIntensity: 80,
      isDefault: false,
    },
  ];

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => SocketService))
    private readonly socketService: SocketService,
    @Inject(forwardRef(() => EventService))
    private readonly eventService: EventService,
    @Inject(forwardRef(() => StaticAssetService))
    private readonly staticAssetService?: StaticAssetService
  ) {}

  /**
   * Update virtual background settings
   */
  async updateBackgroundSettings(
    settings: VirtualBackgroundSettings
  ): Promise<VirtualBackgroundSettings> {
    try {
      // Store settings in cache (client-side processing, no database needed)
      const cacheKey = `virtual_background:${settings.consultationId}:${settings.userId}`;
      await this.cacheService.set(cacheKey, settings, this.BACKGROUND_CACHE_TTL);

      // Emit real-time update via Socket.IO
      const socketData: Record<string, string | number | boolean | null> = {
        userId: settings.userId,
        consultationId: settings.consultationId,
        type: settings.type,
        enabled: settings.enabled,
      };

      if (settings.blurIntensity !== undefined) {
        socketData['blurIntensity'] = settings.blurIntensity;
      }
      if (settings.imageUrl) {
        socketData['imageUrl'] = settings.imageUrl;
      }
      if (settings.videoUrl) {
        socketData['videoUrl'] = settings.videoUrl;
      }
      if (settings.customBackgroundId) {
        socketData['customBackgroundId'] = settings.customBackgroundId;
      }

      this.socketService.sendToRoom(
        `consultation_${settings.consultationId}`,
        'virtual_background_updated',
        socketData
      );

      // Emit event
      await this.eventService.emitEnterprise('video.virtual_background.updated', {
        eventId: `virtual-background-${settings.consultationId}-${Date.now()}`,
        eventType: 'video.virtual_background.updated',
        category: EventCategory.SYSTEM,
        priority: EventPriority.LOW,
        timestamp: new Date().toISOString(),
        source: 'VideoVirtualBackgroundService',
        version: '1.0.0',
        payload: {
          consultationId: settings.consultationId,
          userId: settings.userId,
          type: settings.type,
        },
      });

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Virtual background updated for user ${settings.userId}`,
        'VideoVirtualBackgroundService',
        {
          consultationId: settings.consultationId,
          userId: settings.userId,
          type: settings.type,
        }
      );

      return settings;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to update virtual background: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoVirtualBackgroundService',
        {
          error: error instanceof Error ? error.message : String(error),
          consultationId: settings.consultationId,
          userId: settings.userId,
        }
      );
      throw error;
    }
  }

  /**
   * Get virtual background settings
   */
  async getBackgroundSettings(
    consultationId: string,
    userId: string
  ): Promise<VirtualBackgroundSettings | null> {
    try {
      const cacheKey = `virtual_background:${consultationId}:${userId}`;
      return await this.cacheService.get<VirtualBackgroundSettings>(cacheKey);
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get virtual background settings: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoVirtualBackgroundService',
        {
          error: error instanceof Error ? error.message : String(error),
          consultationId,
          userId,
        }
      );
      return null;
    }
  }

  /**
   * Get available background presets
   */
  getBackgroundPresets(): BackgroundPreset[] {
    return this.DEFAULT_PRESETS;
  }

  /**
   * Upload custom background image
   * Note: This would integrate with file storage service (S3, etc.)
   */
  async uploadCustomBackground(
    consultationId: string,
    userId: string,
    imageData: Buffer,
    fileName: string
  ): Promise<{ imageUrl: string; backgroundId: string }> {
    try {
      const backgroundId = `bg-${consultationId}-${userId}-${Date.now()}`;
      let imageUrl: string;

      // Use StaticAssetService if available, otherwise fallback to placeholder
      if (this.staticAssetService) {
        try {
          // Determine content type from file extension
          const extension = fileName.split('.').pop()?.toLowerCase() || 'jpg';
          const contentTypeMap: Record<string, string> = {
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            webp: 'image/webp',
            mp4: 'video/mp4',
            webm: 'video/webm',
          };
          const contentType = contentTypeMap[extension] || 'image/jpeg';

          // Upload to storage (S3 or local fallback)
          const uploadResult = await this.staticAssetService.uploadFile(
            imageData,
            `${backgroundId}-${fileName}`,
            AssetType.IMAGE,
            contentType,
            true // Public access for backgrounds
          );

          if (uploadResult.success && uploadResult.url) {
            imageUrl = uploadResult.url;
          } else {
            // Fallback to placeholder if upload fails
            imageUrl = `https://storage.example.com/backgrounds/${backgroundId}/${fileName}`;
            void this.loggingService.log(
              LogType.SYSTEM,
              LogLevel.WARN,
              `Background upload returned no URL, using placeholder`,
              'VideoVirtualBackgroundService',
              { backgroundId, fileName }
            );
          }
        } catch (uploadError) {
          // Fallback to placeholder on upload error
          imageUrl = `https://storage.example.com/backgrounds/${backgroundId}/${fileName}`;
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Background upload failed, using placeholder: ${uploadError instanceof Error ? uploadError.message : String(uploadError)}`,
            'VideoVirtualBackgroundService',
            { backgroundId, fileName }
          );
        }
      } else {
        // StaticAssetService not available, use placeholder
        imageUrl = `https://storage.example.com/backgrounds/${backgroundId}/${fileName}`;
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `StaticAssetService not available, using placeholder URL`,
          'VideoVirtualBackgroundService',
          { backgroundId, fileName }
        );
      }

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Custom background uploaded: ${backgroundId}`,
        'VideoVirtualBackgroundService',
        {
          consultationId,
          userId,
          backgroundId,
          fileName,
          imageUrl,
        }
      );

      return { imageUrl, backgroundId };
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to upload custom background: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoVirtualBackgroundService',
        {
          error: error instanceof Error ? error.message : String(error),
          consultationId,
          userId,
        }
      );
      throw error;
    }
  }
}
