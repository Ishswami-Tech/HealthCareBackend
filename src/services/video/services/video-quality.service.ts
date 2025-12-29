/**
 * Video Quality Service
 * @class VideoQualityService
 * @description Enhanced call quality monitoring and optimization
 * Supports network status, video/audio quality metrics, connection warnings, and auto-quality adjustment
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { SocketService } from '@communication/channels/socket/socket.service';
import { EventService } from '@infrastructure/events';
import { LogType, LogLevel, EventCategory, EventPriority } from '@core/types';
import { getVideoParticipantDelegate } from '@core/types/video-database.types';
import type { PrismaTransactionClient } from '@core/types/database.types';

export interface NetworkMetrics {
  latency: number; // milliseconds
  bandwidth: number; // kbps
  packetLoss: number; // percentage
  jitter: number; // milliseconds
  connectionType?: 'wifi' | 'cellular' | 'ethernet' | 'unknown';
}

export interface QualityMetrics {
  videoQuality: {
    resolution: string;
    frameRate: number;
    bitrate: number;
    quality: 'excellent' | 'good' | 'fair' | 'poor';
  };
  audioQuality: {
    bitrate: number;
    sampleRate: number;
    quality: 'excellent' | 'good' | 'fair' | 'poor';
  };
  networkMetrics: NetworkMetrics;
  overallQuality: 'excellent' | 'good' | 'fair' | 'poor';
}

import type { UpdateQualityMetricsDto } from '@dtos/video.dto';

export type QualityUpdateDto = UpdateQualityMetricsDto;

export interface QualityWarning {
  type: 'network' | 'video' | 'audio' | 'connection';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  recommendation?: string;
  timestamp: Date;
}

@Injectable()
export class VideoQualityService {
  private readonly QUALITY_CACHE_TTL = 300; // 5 minutes
  private readonly QUALITY_THRESHOLDS = {
    excellent: { latency: 50, bandwidth: 2000, packetLoss: 0.5 },
    good: { latency: 100, bandwidth: 1000, packetLoss: 1.0 },
    fair: { latency: 200, bandwidth: 500, packetLoss: 2.0 },
    poor: { latency: Infinity, bandwidth: 0, packetLoss: Infinity },
  };

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => SocketService))
    private readonly socketService: SocketService,
    @Inject(forwardRef(() => EventService))
    private readonly eventService: EventService
  ) {}

  /**
   * Update quality metrics
   */
  async updateQualityMetrics(dto: QualityUpdateDto): Promise<QualityMetrics> {
    try {
      // Calculate overall quality
      const overallQuality = this.calculateOverallQuality(dto);

      // Store metrics in cache
      const cacheKey = `quality:${dto.consultationId}:${dto.userId}`;
      const metrics: QualityMetrics = {
        videoQuality: dto.videoQuality || {
          resolution: 'unknown',
          frameRate: 0,
          bitrate: 0,
          quality: 'poor',
        },
        audioQuality: dto.audioQuality || {
          bitrate: 0,
          sampleRate: 0,
          quality: 'poor',
        },
        networkMetrics: dto.networkMetrics || {
          latency: 0,
          bandwidth: 0,
          packetLoss: 0,
          jitter: 0,
        },
        overallQuality,
      };

      await this.cacheService.set(cacheKey, metrics, this.QUALITY_CACHE_TTL);

      // Check for warnings
      const warnings = this.checkQualityWarnings(metrics);

      // Emit warnings if any
      if (warnings.length > 0) {
        const warningsData: Record<string, string | number | boolean | null> = {};
        warnings.forEach((w, index) => {
          warningsData[`${index}_type`] = w.type;
          warningsData[`${index}_severity`] = w.severity;
          warningsData[`${index}_message`] = w.message;
          if (w.recommendation) {
            warningsData[`${index}_recommendation`] = w.recommendation;
          }
          warningsData[`${index}_timestamp`] = w.timestamp.toISOString();
        });

        this.socketService.sendToRoom(`consultation_${dto.consultationId}`, 'quality_warnings', {
          userId: dto.userId,
          ...warningsData,
        });

        // Emit event for critical warnings
        const criticalWarnings = warnings.filter(w => w.severity === 'critical');
        if (criticalWarnings.length > 0) {
          await this.eventService.emitEnterprise('video.quality.critical_warning', {
            eventId: `quality-warning-${dto.consultationId}-${Date.now()}`,
            eventType: 'video.quality.critical_warning',
            category: EventCategory.SYSTEM,
            priority: EventPriority.HIGH,
            timestamp: new Date().toISOString(),
            source: 'VideoQualityService',
            version: '1.0.0',
            payload: {
              consultationId: dto.consultationId,
              userId: dto.userId,
              warnings: criticalWarnings,
            },
          });
        }
      }

      // Update participant quality in database
      await this.updateParticipantQuality(dto.consultationId, dto.userId, metrics);

      // Emit real-time quality update
      const metricsData: Record<
        string,
        string | number | boolean | null | Record<string, string | number | boolean | null>
      > = {
        userId: dto.userId,
        overallQuality: metrics.overallQuality,
        videoQuality: {
          resolution: metrics.videoQuality.resolution,
          frameRate: metrics.videoQuality.frameRate,
          bitrate: metrics.videoQuality.bitrate,
          quality: metrics.videoQuality.quality,
        },
        audioQuality: {
          bitrate: metrics.audioQuality.bitrate,
          sampleRate: metrics.audioQuality.sampleRate,
          quality: metrics.audioQuality.quality,
        },
        networkMetrics: {
          latency: metrics.networkMetrics.latency,
          bandwidth: metrics.networkMetrics.bandwidth,
          packetLoss: metrics.networkMetrics.packetLoss,
          jitter: metrics.networkMetrics.jitter,
          ...(metrics.networkMetrics.connectionType && {
            connectionType: metrics.networkMetrics.connectionType,
          }),
        },
      };

      this.socketService.sendToRoom(
        `consultation_${dto.consultationId}`,
        'quality_update',
        metricsData
      );

      return metrics;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to update quality metrics: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoQualityService',
        {
          error: error instanceof Error ? error.message : String(error),
          consultationId: dto.consultationId,
          userId: dto.userId,
        }
      );
      throw error;
    }
  }

  /**
   * Get quality metrics for a participant
   */
  async getQualityMetrics(consultationId: string, userId: string): Promise<QualityMetrics | null> {
    try {
      const cacheKey = `quality:${consultationId}:${userId}`;
      return await this.cacheService.get<QualityMetrics>(cacheKey);
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get quality metrics: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoQualityService',
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
   * Get quality recommendations
   */
  getQualityRecommendations(metrics: QualityMetrics): string[] {
    const recommendations: string[] = [];

    if (metrics.networkMetrics.latency > 200) {
      recommendations.push(
        'High latency detected. Try moving closer to your router or use a wired connection.'
      );
    }

    if (metrics.networkMetrics.bandwidth < 500) {
      recommendations.push('Low bandwidth detected. Close other applications using internet.');
    }

    if (metrics.networkMetrics.packetLoss > 2.0) {
      recommendations.push('Packet loss detected. Check your internet connection stability.');
    }

    if (metrics.videoQuality.quality === 'poor') {
      recommendations.push(
        'Video quality is poor. Consider reducing video resolution or frame rate.'
      );
    }

    if (metrics.audioQuality.quality === 'poor') {
      recommendations.push('Audio quality is poor. Check your microphone and internet connection.');
    }

    return recommendations;
  }

  /**
   * Calculate overall quality
   */
  private calculateOverallQuality(dto: QualityUpdateDto): QualityMetrics['overallQuality'] {
    if (!dto.networkMetrics) {
      return 'poor';
    }

    const { latency, bandwidth, packetLoss } = dto.networkMetrics;

    // Determine quality based on thresholds
    if (
      latency <= this.QUALITY_THRESHOLDS.excellent.latency &&
      bandwidth >= this.QUALITY_THRESHOLDS.excellent.bandwidth &&
      packetLoss <= this.QUALITY_THRESHOLDS.excellent.packetLoss
    ) {
      return 'excellent';
    }

    if (
      latency <= this.QUALITY_THRESHOLDS.good.latency &&
      bandwidth >= this.QUALITY_THRESHOLDS.good.bandwidth &&
      packetLoss <= this.QUALITY_THRESHOLDS.good.packetLoss
    ) {
      return 'good';
    }

    if (
      latency <= this.QUALITY_THRESHOLDS.fair.latency &&
      bandwidth >= this.QUALITY_THRESHOLDS.fair.bandwidth &&
      packetLoss <= this.QUALITY_THRESHOLDS.fair.packetLoss
    ) {
      return 'fair';
    }

    return 'poor';
  }

  /**
   * Check for quality warnings
   */
  private checkQualityWarnings(metrics: QualityMetrics): QualityWarning[] {
    const warnings: QualityWarning[] = [];

    // Network warnings
    if (metrics.networkMetrics.latency > 300) {
      warnings.push({
        type: 'network',
        severity: metrics.networkMetrics.latency > 500 ? 'critical' : 'high',
        message: `High latency detected: ${metrics.networkMetrics.latency}ms`,
        recommendation: 'Try moving closer to your router or use a wired connection.',
        timestamp: new Date(),
      });
    }

    if (metrics.networkMetrics.bandwidth < 500) {
      warnings.push({
        type: 'network',
        severity: metrics.networkMetrics.bandwidth < 250 ? 'critical' : 'high',
        message: `Low bandwidth detected: ${metrics.networkMetrics.bandwidth}kbps`,
        recommendation: 'Close other applications using internet.',
        timestamp: new Date(),
      });
    }

    if (metrics.networkMetrics.packetLoss > 2.0) {
      warnings.push({
        type: 'network',
        severity: metrics.networkMetrics.packetLoss > 5.0 ? 'critical' : 'high',
        message: `Packet loss detected: ${metrics.networkMetrics.packetLoss}%`,
        recommendation: 'Check your internet connection stability.',
        timestamp: new Date(),
      });
    }

    // Video quality warnings
    if (metrics.videoQuality.quality === 'poor') {
      warnings.push({
        type: 'video',
        severity: 'high',
        message: 'Video quality is poor',
        recommendation: 'Consider reducing video resolution or frame rate.',
        timestamp: new Date(),
      });
    }

    // Audio quality warnings
    if (metrics.audioQuality.quality === 'poor') {
      warnings.push({
        type: 'audio',
        severity: 'high',
        message: 'Audio quality is poor',
        recommendation: 'Check your microphone and internet connection.',
        timestamp: new Date(),
      });
    }

    return warnings;
  }

  /**
   * Update participant quality in database
   */
  private async updateParticipantQuality(
    consultationId: string,
    userId: string,
    metrics: QualityMetrics
  ): Promise<void> {
    try {
      await this.databaseService.executeHealthcareWrite(
        async (client: PrismaTransactionClient) => {
          const delegate = getVideoParticipantDelegate(client);
          const participant = await delegate.findFirst({
            where: {
              consultationId,
              userId,
            },
          });

          if (participant) {
            await delegate.update({
              where: { id: participant.id },
              data: {
                audioQuality: this.mapQualityToNumber(metrics.audioQuality.quality),
                videoQuality: this.mapQualityToNumber(metrics.videoQuality.quality),
                connectionQuality: this.mapQualityToNumber(metrics.overallQuality),
              },
            });
          }
        },
        {
          userId,
          userRole: 'PATIENT',
          clinicId: '',
          operation: 'UPDATE_QUALITY_METRICS',
          resourceType: 'VIDEO_PARTICIPANT',
          resourceId: consultationId,
          timestamp: new Date(),
        }
      );
    } catch (error) {
      // Log but don't throw - quality updates are non-critical
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Failed to update participant quality: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoQualityService',
        {
          error: error instanceof Error ? error.message : String(error),
          consultationId,
          userId,
        }
      );
    }
  }

  /**
   * Map quality string to number (for database storage)
   */
  private mapQualityToNumber(quality: 'excellent' | 'good' | 'fair' | 'poor'): number {
    switch (quality) {
      case 'excellent':
        return 1.0;
      case 'good':
        return 0.75;
      case 'fair':
        return 0.5;
      case 'poor':
        return 0.25;
      default:
        return 0.5;
    }
  }
}
