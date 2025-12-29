/**
 * Video Annotation Service
 * @class VideoAnnotationService
 * @description Screen annotation during video consultations
 * Supports drawing, highlighting, arrows, text, shapes, and collaborative markup
 */

import { Injectable, Inject, forwardRef, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { SocketService } from '@communication/channels/socket/socket.service';
import { EventService } from '@infrastructure/events';
import { LogType, LogLevel, EventCategory, EventPriority } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import type { PrismaTransactionClient } from '@core/types/database.types';

export interface Annotation {
  id: string;
  consultationId: string;
  userId: string;
  annotationType: 'DRAWING' | 'HIGHLIGHT' | 'ARROW' | 'TEXT' | 'SHAPE';
  data: {
    paths?: Array<{ x: number; y: number }>;
    text?: string;
    shape?: 'circle' | 'rectangle' | 'line';
    coordinates?: { x: number; y: number; width: number; height: number };
    [key: string]: unknown;
  };
  position?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  color?: string;
  thickness?: number;
  isVisible: boolean;
  createdAt: Date;
  updatedAt: Date;
}

import type { CreateAnnotationDto as CreateAnnotationDtoType } from '@dtos/video.dto';

export type CreateAnnotationDto = CreateAnnotationDtoType;

@Injectable()
export class VideoAnnotationService {
  private readonly ANNOTATION_CACHE_TTL = 3600; // 1 hour

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
   * Create an annotation
   */
  async createAnnotation(dto: CreateAnnotationDto): Promise<Annotation> {
    try {
      // Validate consultation exists and user is participant
      await this.validateParticipant(dto.consultationId, dto.userId);

      // Create annotation in database
      const annotationResult = await this.databaseService.executeHealthcareWrite(
        async (client: PrismaTransactionClient) => {
          const { getVideoAnnotationDelegate } = await import('@core/types/video-database.types');
          const delegate = getVideoAnnotationDelegate(client);
          const result = (await delegate.create({
            data: {
              consultationId: dto.consultationId,
              userId: dto.userId,
              annotationType: dto.annotationType,
              data: dto.data as unknown,
              position: dto.position as unknown,
              color: dto.color,
              thickness: dto.thickness,
              isVisible: true,
            },
          })) as {
            id: string;
            consultationId: string;
            userId: string;
            annotationType: string;
            data: unknown;
            position?: unknown;
            color?: string | null;
            thickness?: number | null;
            isVisible: boolean;
            createdAt: Date;
            updatedAt: Date;
          };
          return result;
        },
        {
          userId: dto.userId,
          userRole: 'PATIENT',
          clinicId: '',
          operation: 'CREATE_ANNOTATION',
          resourceType: 'VIDEO_ANNOTATION',
          resourceId: dto.consultationId,
          timestamp: new Date(),
        }
      );

      // Map to Annotation interface
      const mappedAnnotation = this.mapToAnnotation(annotationResult);

      // Emit real-time update via Socket.IO
      const socketData: Record<
        string,
        string | number | boolean | null | Record<string, string | number | boolean | null>
      > = {
        id: mappedAnnotation.id,
        consultationId: mappedAnnotation.consultationId,
        userId: mappedAnnotation.userId,
        annotationType: mappedAnnotation.annotationType,
        isVisible: mappedAnnotation.isVisible,
        createdAt: mappedAnnotation.createdAt.toISOString(),
        updatedAt: mappedAnnotation.updatedAt.toISOString(),
      };

      if (mappedAnnotation.color) {
        socketData['color'] = mappedAnnotation.color;
      }
      if (mappedAnnotation.thickness !== undefined) {
        socketData['thickness'] = mappedAnnotation.thickness;
      }
      if (mappedAnnotation.position) {
        socketData['position'] = mappedAnnotation.position as Record<string, number>;
      }
      if (mappedAnnotation.data) {
        socketData['data'] = mappedAnnotation.data as Record<
          string,
          string | number | boolean | null
        >;
      }

      this.socketService.sendToRoom(
        `consultation_${dto.consultationId}`,
        'annotation_created',
        socketData
      );

      // Emit event
      await this.eventService.emitEnterprise('video.annotation.created', {
        eventId: `annotation-${annotationResult.id}-${Date.now()}`,
        eventType: 'video.annotation.created',
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: new Date().toISOString(),
        source: 'VideoAnnotationService',
        version: '1.0.0',
        payload: {
          annotationId: annotationResult.id,
          consultationId: dto.consultationId,
          userId: dto.userId,
          annotationType: dto.annotationType,
        },
      });

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Annotation created: ${annotationResult.id}`,
        'VideoAnnotationService',
        {
          annotationId: annotationResult.id,
          consultationId: dto.consultationId,
          userId: dto.userId,
          annotationType: dto.annotationType,
        }
      );

      return mappedAnnotation;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to create annotation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoAnnotationService',
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
   * Get annotations for a consultation
   */
  async getAnnotations(consultationId: string): Promise<Annotation[]> {
    try {
      const cacheKey = `annotations:${consultationId}`;
      const cached = await this.cacheService.get<Annotation[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const annotationsResult = await this.databaseService.executeHealthcareRead(
        async (client: PrismaTransactionClient) => {
          const { getVideoAnnotationDelegate } = await import('@core/types/video-database.types');
          const delegate = getVideoAnnotationDelegate(client);
          const result = (await delegate.findMany({
            where: {
              consultationId,
              isVisible: true,
            },
            orderBy: {
              createdAt: 'asc',
            },
          })) as Array<{
            id: string;
            consultationId: string;
            userId: string;
            annotationType: string;
            data: unknown;
            position?: unknown;
            color?: string | null;
            thickness?: number | null;
            isVisible: boolean;
            createdAt: Date;
            updatedAt: Date;
          }>;
          return result;
        }
      );

      const result = annotationsResult.map(annotation => this.mapToAnnotation(annotation));

      // Cache result
      await this.cacheService.set(cacheKey, result, this.ANNOTATION_CACHE_TTL);

      return result;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get annotations: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoAnnotationService',
        {
          error: error instanceof Error ? error.message : String(error),
          consultationId,
        }
      );
      throw error;
    }
  }

  /**
   * Delete an annotation
   */
  async deleteAnnotation(annotationId: string, userId: string): Promise<void> {
    try {
      const annotationResult = await this.databaseService.executeHealthcareRead(
        async (client: PrismaTransactionClient) => {
          const { getVideoAnnotationDelegate } = await import('@core/types/video-database.types');
          const delegate = getVideoAnnotationDelegate(client);
          const result = (await delegate.findUnique({
            where: { id: annotationId },
          })) as {
            id: string;
            consultationId: string;
            userId: string;
          } | null;
          return result;
        }
      );

      if (!annotationResult) {
        throw new NotFoundException(`Annotation ${annotationId} not found`);
      }

      if (annotationResult.userId !== userId) {
        throw new HealthcareError(
          ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
          'You can only delete your own annotations',
          undefined,
          { annotationId, userId },
          'VideoAnnotationService.deleteAnnotation'
        );
      }

      await this.databaseService.executeHealthcareWrite(
        async (client: PrismaTransactionClient) => {
          const { getVideoAnnotationDelegate } = await import('@core/types/video-database.types');
          const delegate = getVideoAnnotationDelegate(client);
          await delegate.update({
            where: { id: annotationId },
            data: {
              isVisible: false,
            },
          });
        },
        {
          userId,
          userRole: 'PATIENT',
          clinicId: '',
          operation: 'DELETE_ANNOTATION',
          resourceType: 'VIDEO_ANNOTATION',
          resourceId: annotationId,
          timestamp: new Date(),
        }
      );

      // Clear cache
      await this.cacheService.delete(`annotations:${annotationResult.consultationId}`);

      // Emit real-time update
      this.socketService.sendToRoom(
        `consultation_${annotationResult.consultationId}`,
        'annotation_deleted',
        {
          annotationId,
        }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to delete annotation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoAnnotationService',
        {
          error: error instanceof Error ? error.message : String(error),
          annotationId,
          userId,
        }
      );
      throw error;
    }
  }

  /**
   * Clear all annotations for a consultation
   */
  async clearAnnotations(consultationId: string, userId: string): Promise<void> {
    try {
      await this.validateParticipant(consultationId, userId);

      await this.databaseService.executeHealthcareWrite(
        async (client: PrismaTransactionClient) => {
          const { getVideoAnnotationDelegate } = await import('@core/types/video-database.types');
          const delegate = getVideoAnnotationDelegate(client);
          await delegate.updateMany({
            where: {
              consultationId,
              isVisible: true,
            },
            data: {
              isVisible: false,
            },
          });
        },
        {
          userId,
          userRole: 'PATIENT',
          clinicId: '',
          operation: 'CLEAR_ANNOTATIONS',
          resourceType: 'VIDEO_ANNOTATION',
          resourceId: consultationId,
          timestamp: new Date(),
        }
      );

      // Clear cache
      await this.cacheService.delete(`annotations:${consultationId}`);

      // Emit real-time update
      this.socketService.sendToRoom(`consultation_${consultationId}`, 'annotations_cleared', {
        consultationId,
      });
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to clear annotations: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoAnnotationService',
        {
          error: error instanceof Error ? error.message : String(error),
          consultationId,
          userId,
        }
      );
      throw error;
    }
  }

  /**
   * Validate user is a participant
   */
  private async validateParticipant(consultationId: string, userId: string): Promise<void> {
    const consultation = await this.databaseService.executeHealthcareRead(
      async (client: PrismaTransactionClient) => {
        const { getVideoConsultationDelegate } = await import('@core/types/video-database.types');
        const delegate = getVideoConsultationDelegate(client);
        const result = await delegate.findFirst({
          where: {
            id: consultationId,
          },
          include: {
            participants: true,
          },
        });
        return result;
      }
    );

    if (!consultation) {
      throw new NotFoundException(`Consultation ${consultationId} not found`);
    }

    const isParticipant =
      consultation.patientId === userId ||
      consultation.doctorId === userId ||
      consultation.participants.some(p => p.userId === userId);

    if (!isParticipant) {
      throw new HealthcareError(
        ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
        'User is not a participant in this consultation',
        undefined,
        { consultationId, userId },
        'VideoAnnotationService.validateParticipant'
      );
    }
  }

  /**
   * Map database model to Annotation interface
   */
  private mapToAnnotation(annotation: {
    id: string;
    consultationId: string;
    userId: string;
    annotationType: string;
    data: unknown;
    position?: unknown;
    color?: string | null;
    thickness?: number | null;
    isVisible: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): Annotation {
    const result: Annotation = {
      id: annotation.id,
      consultationId: annotation.consultationId,
      userId: annotation.userId,
      annotationType: annotation.annotationType as Annotation['annotationType'],
      data: annotation.data as Annotation['data'],
      isVisible: annotation.isVisible,
      createdAt: annotation.createdAt,
      updatedAt: annotation.updatedAt,
    };

    if (annotation.position) {
      const position = annotation.position as
        | {
            x: number;
            y: number;
            width: number;
            height: number;
          }
        | undefined;
      if (
        position &&
        typeof position === 'object' &&
        'x' in position &&
        'y' in position &&
        'width' in position &&
        'height' in position
      ) {
        // Type guard ensures position is not undefined
        result.position = {
          x: position.x,
          y: position.y,
          width: position.width,
          height: position.height,
        };
      }
    }
    if (annotation.color) {
      result.color = annotation.color;
    }
    if (annotation.thickness !== undefined && annotation.thickness !== null) {
      result.thickness = annotation.thickness;
    }

    return result;
  }
}
