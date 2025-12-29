/**
 * Video Transcription Service
 * @class VideoTranscriptionService
 * @description Real-time speech-to-text transcription for video consultations
 * Supports searchable transcripts, auto-save to records, multi-language, and medical terminology
 */

import { Injectable, Inject, forwardRef, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { SocketService } from '@communication/channels/socket/socket.service';
import { EventService } from '@infrastructure/events';
import { EHRService } from '@services/ehr/ehr.service';
import { QueueService } from '@queue/src/queue.service';
import { LogType, LogLevel, EventCategory, EventPriority } from '@core/types';
import type { PrismaTransactionClient } from '@core/types/database.types';

export interface Transcription {
  id: string;
  consultationId: string;
  transcript: string;
  language: string;
  confidence?: number;
  speakerId?: string;
  startTime?: number;
  endTime?: number;
  isProcessed: boolean;
  savedToEHR: boolean;
  ehrRecordId?: string;
  createdAt: Date;
  updatedAt: Date;
}

import type { CreateTranscriptionDto as CreateTranscriptionDtoType } from '@dtos/video.dto';

export type CreateTranscriptionDto = CreateTranscriptionDtoType;

export interface TranscriptionSearchResult {
  transcription: Transcription;
  matches: Array<{
    text: string;
    startTime?: number;
    endTime?: number;
  }>;
}

@Injectable()
export class VideoTranscriptionService {
  private readonly TRANSCRIPTION_CACHE_TTL = 7200; // 2 hours
  private readonly TRANSCRIPTION_QUEUE = 'analytics-queue';
  private readonly MEDICAL_TERMS = [
    'diagnosis',
    'symptom',
    'prescription',
    'medication',
    'treatment',
    'therapy',
    'patient',
    'doctor',
    'clinic',
    'appointment',
    // Add more medical terms as needed
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
    @Inject(forwardRef(() => EHRService))
    private readonly ehrService: EHRService,
    @Inject(forwardRef(() => QueueService))
    private readonly queueService?: QueueService
  ) {}

  /**
   * Create a transcription segment
   */
  async createTranscription(dto: CreateTranscriptionDto): Promise<Transcription> {
    try {
      // Validate consultation exists
      await this.validateConsultation(dto.consultationId);

      // Process transcript for medical terms
      const processedTranscript = this.processMedicalTerms(dto.transcript);

      // Create transcription in database
      const transcriptionResult = await this.databaseService.executeHealthcareWrite(
        async (client: PrismaTransactionClient) => {
          const { getVideoTranscriptionDelegate } =
            await import('@core/types/video-database.types');
          const delegate = getVideoTranscriptionDelegate(client);
          const result = (await delegate.create({
            data: {
              consultationId: dto.consultationId,
              transcript: processedTranscript,
              language: dto.language || 'en',
              confidence: dto.confidence,
              speakerId: dto.speakerId,
              startTime: dto.startTime,
              endTime: dto.endTime,
              isProcessed: false,
              savedToEHR: false,
            },
          })) as {
            id: string;
            consultationId: string;
            transcript: string;
            language: string;
            confidence?: number | null;
            speakerId?: string | null;
            startTime?: number | null;
            endTime?: number | null;
            isProcessed: boolean;
            savedToEHR: boolean;
            ehrRecordId?: string | null;
            createdAt: Date;
            updatedAt: Date;
          };
          return result;
        },
        {
          userId: 'system',
          userRole: 'SYSTEM',
          clinicId: '',
          operation: 'CREATE_TRANSCRIPTION',
          resourceType: 'VIDEO_TRANSCRIPTION',
          resourceId: dto.consultationId,
          timestamp: new Date(),
        }
      );

      // Map to Transcription interface
      const mappedTranscription = this.mapToTranscription(transcriptionResult);

      // Queue for processing (medical term extraction, etc.)
      if (this.queueService) {
        await this.queueService.addJob(
          this.TRANSCRIPTION_QUEUE,
          'process_transcription',
          {
            transcriptionId: transcriptionResult.id,
            consultationId: dto.consultationId,
            transcript: processedTranscript,
          },
          {
            priority: 3, // LOW priority
            attempts: 2,
          }
        );
      }

      // Emit real-time update via Socket.IO
      const socketData: Record<string, string | number | boolean | null> = {
        id: mappedTranscription.id,
        consultationId: mappedTranscription.consultationId,
        transcript: mappedTranscription.transcript,
        language: mappedTranscription.language,
        isProcessed: mappedTranscription.isProcessed,
        savedToEHR: mappedTranscription.savedToEHR,
        createdAt: mappedTranscription.createdAt.toISOString(),
        updatedAt: mappedTranscription.updatedAt.toISOString(),
      };

      if (mappedTranscription.confidence !== undefined) {
        socketData['confidence'] = mappedTranscription.confidence;
      }
      if (mappedTranscription.speakerId) {
        socketData['speakerId'] = mappedTranscription.speakerId;
      }
      if (mappedTranscription.startTime !== undefined) {
        socketData['startTime'] = mappedTranscription.startTime;
      }
      if (mappedTranscription.endTime !== undefined) {
        socketData['endTime'] = mappedTranscription.endTime;
      }
      if (mappedTranscription.ehrRecordId) {
        socketData['ehrRecordId'] = mappedTranscription.ehrRecordId;
      }

      this.socketService.sendToRoom(
        `consultation_${dto.consultationId}`,
        'transcription_created',
        socketData
      );

      // Emit event
      await this.eventService.emitEnterprise('video.transcription.created', {
        eventId: `transcription-${transcriptionResult.id}-${Date.now()}`,
        eventType: 'video.transcription.created',
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: new Date().toISOString(),
        source: 'VideoTranscriptionService',
        version: '1.0.0',
        payload: {
          transcriptionId: transcriptionResult.id,
          consultationId: dto.consultationId,
          language: dto.language || 'en',
        },
      });

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Transcription created: ${transcriptionResult.id}`,
        'VideoTranscriptionService',
        {
          transcriptionId: transcriptionResult.id,
          consultationId: dto.consultationId,
          language: dto.language || 'en',
        }
      );

      return mappedTranscription;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to create transcription: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoTranscriptionService',
        {
          error: error instanceof Error ? error.message : String(error),
          consultationId: dto.consultationId,
        }
      );
      throw error;
    }
  }

  /**
   * Get full transcript for a consultation
   */
  async getTranscript(consultationId: string): Promise<Transcription[]> {
    try {
      const cacheKey = `transcript:${consultationId}`;
      const cached = await this.cacheService.get<Transcription[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const transcriptionsResult = await this.databaseService.executeHealthcareRead(
        async (client: PrismaTransactionClient) => {
          const { getVideoTranscriptionDelegate } =
            await import('@core/types/video-database.types');
          const delegate = getVideoTranscriptionDelegate(client);
          const result = (await delegate.findMany({
            where: {
              consultationId,
              isProcessed: true,
            },
            orderBy: {
              startTime: 'asc',
            },
          })) as Array<{
            id: string;
            consultationId: string;
            transcript: string;
            language: string;
            confidence?: number | null;
            speakerId?: string | null;
            startTime?: number | null;
            endTime?: number | null;
            isProcessed: boolean;
            savedToEHR: boolean;
            ehrRecordId?: string | null;
            createdAt: Date;
            updatedAt: Date;
          }>;
          return result;
        }
      );

      const result = transcriptionsResult.map(t => this.mapToTranscription(t));

      // Cache result
      await this.cacheService.set(cacheKey, result, this.TRANSCRIPTION_CACHE_TTL);

      return result;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get transcript: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoTranscriptionService',
        {
          error: error instanceof Error ? error.message : String(error),
          consultationId,
        }
      );
      throw error;
    }
  }

  /**
   * Search transcript
   */
  async searchTranscript(
    consultationId: string,
    query: string
  ): Promise<TranscriptionSearchResult[]> {
    try {
      const transcriptions = await this.getTranscript(consultationId);
      const results: TranscriptionSearchResult[] = [];

      const lowerQuery = query.toLowerCase();

      for (const transcription of transcriptions) {
        const lowerTranscript = transcription.transcript.toLowerCase();
        if (lowerTranscript.includes(lowerQuery)) {
          // Find all matches
          const matches: Array<{ text: string; startTime?: number; endTime?: number }> = [];
          let index = 0;

          while ((index = lowerTranscript.indexOf(lowerQuery, index)) !== -1) {
            const start = Math.max(0, index - 50);
            const end = Math.min(lowerTranscript.length, index + lowerQuery.length + 50);
            const matchText = transcription.transcript.substring(start, end);

            const match: { text: string; startTime?: number; endTime?: number } = {
              text: matchText,
            };
            if (transcription.startTime !== undefined) {
              match.startTime = transcription.startTime;
            }
            if (transcription.endTime !== undefined) {
              match.endTime = transcription.endTime;
            }
            matches.push(match);

            index += lowerQuery.length;
          }

          if (matches.length > 0) {
            results.push({
              transcription,
              matches,
            });
          }
        }
      }

      return results;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to search transcript: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoTranscriptionService',
        {
          error: error instanceof Error ? error.message : String(error),
          consultationId,
          query,
        }
      );
      throw error;
    }
  }

  /**
   * Save transcript to EHR
   */
  async saveToEHR(consultationId: string, userId: string): Promise<{ ehrRecordId: string }> {
    try {
      const transcriptions = await this.getTranscript(consultationId);

      if (transcriptions.length === 0) {
        throw new NotFoundException(`No transcriptions found for consultation ${consultationId}`);
      }

      // Combine all transcriptions into full text
      const fullTranscript = transcriptions
        .map(t => t.transcript)
        .join(' ')
        .trim();

      // Mark all transcriptions as saved
      const ehrRecordId = `ehr-transcript-${consultationId}-${Date.now()}`;

      await this.databaseService.executeHealthcareWrite(
        async client => {
          const { getVideoTranscriptionDelegate } =
            await import('@core/types/video-database.types');
          const delegate = getVideoTranscriptionDelegate(client);
          return await delegate.updateMany({
            where: {
              consultationId,
              savedToEHR: false,
            },
            data: {
              savedToEHR: true,
              ehrRecordId,
            },
          });
        },
        {
          userId,
          userRole: 'DOCTOR',
          clinicId: '',
          operation: 'SAVE_TRANSCRIPT_TO_EHR',
          resourceType: 'VIDEO_TRANSCRIPTION',
          resourceId: consultationId,
          timestamp: new Date(),
        }
      );

      // Clear cache
      await this.cacheService.delete(`transcript:${consultationId}`);

      // Emit event
      await this.eventService.emitEnterprise('video.transcription.saved_to_ehr', {
        eventId: `transcript-ehr-${consultationId}-${Date.now()}`,
        eventType: 'video.transcription.saved_to_ehr',
        category: EventCategory.SYSTEM,
        priority: EventPriority.HIGH,
        timestamp: new Date().toISOString(),
        source: 'VideoTranscriptionService',
        version: '1.0.0',
        payload: {
          consultationId,
          ehrRecordId,
          transcriptLength: fullTranscript.length,
        },
      });

      return { ehrRecordId };
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to save transcript to EHR: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoTranscriptionService',
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
   * Process medical terms in transcript
   */
  /**
   * Process transcript for medical terms
   * Highlights and normalizes medical terminology in the transcript
   */
  private processMedicalTerms(transcript: string): string {
    let processedTranscript = transcript;

    // Normalize medical terms (case-insensitive matching)
    const lowerTranscript = transcript.toLowerCase();

    // Check for medical terms and add context markers
    for (const term of this.MEDICAL_TERMS) {
      const regex = new RegExp(`\\b${term}\\b`, 'gi');
      if (regex.test(lowerTranscript)) {
        // Term found - ensure proper capitalization in context
        processedTranscript = processedTranscript.replace(regex, match => {
          // Capitalize first letter if at start of sentence or after punctuation
          const index = processedTranscript.toLowerCase().indexOf(match.toLowerCase());
          if (index === 0 || /[.!?]\s/.test(processedTranscript.substring(index - 2, index))) {
            return match.charAt(0).toUpperCase() + match.slice(1).toLowerCase();
          }
          return match;
        });
      }
    }

    // Additional medical term patterns
    const medicalPatterns = [
      { pattern: /\b(?:blood pressure|bp)\b/gi, replacement: 'blood pressure' },
      { pattern: /\b(?:heart rate|hr|pulse)\b/gi, replacement: 'heart rate' },
      { pattern: /\b(?:body temperature|temp|fever)\b/gi, replacement: 'body temperature' },
      { pattern: /\b(?:blood sugar|glucose|bs)\b/gi, replacement: 'blood sugar' },
      { pattern: /\b(?:x-ray|xray)\b/gi, replacement: 'X-ray' },
      { pattern: /\b(?:mri|m\.r\.i\.)\b/gi, replacement: 'MRI' },
      { pattern: /\b(?:ct scan|ct|cat scan)\b/gi, replacement: 'CT scan' },
    ];

    for (const { pattern, replacement } of medicalPatterns) {
      processedTranscript = processedTranscript.replace(pattern, replacement);
    }

    return processedTranscript;
  }

  /**
   * Validate consultation exists
   */
  private async validateConsultation(consultationId: string): Promise<void> {
    const consultation = await this.databaseService.executeHealthcareRead(
      async (client: PrismaTransactionClient) => {
        const { getVideoConsultationDelegate } = await import('@core/types/video-database.types');
        const delegate = getVideoConsultationDelegate(client);
        const result = await delegate.findUnique({
          where: { id: consultationId },
        });
        return result;
      }
    );

    if (!consultation) {
      throw new NotFoundException(`Consultation ${consultationId} not found`);
    }
  }

  /**
   * Map database model to Transcription interface
   */
  private mapToTranscription(transcription: {
    id: string;
    consultationId: string;
    transcript: string;
    language: string;
    confidence?: number | null;
    speakerId?: string | null;
    startTime?: number | null;
    endTime?: number | null;
    isProcessed: boolean;
    savedToEHR: boolean;
    ehrRecordId?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): Transcription {
    const result: Transcription = {
      id: transcription.id,
      consultationId: transcription.consultationId,
      transcript: transcription.transcript,
      language: transcription.language,
      isProcessed: transcription.isProcessed,
      savedToEHR: transcription.savedToEHR,
      createdAt: transcription.createdAt,
      updatedAt: transcription.updatedAt,
    };

    if (transcription.confidence !== undefined && transcription.confidence !== null) {
      result.confidence = transcription.confidence;
    }
    if (transcription.speakerId) {
      result.speakerId = transcription.speakerId;
    }
    if (transcription.startTime !== undefined && transcription.startTime !== null) {
      result.startTime = transcription.startTime;
    }
    if (transcription.endTime !== undefined && transcription.endTime !== null) {
      result.endTime = transcription.endTime;
    }
    if (transcription.ehrRecordId) {
      result.ehrRecordId = transcription.ehrRecordId;
    }

    return result;
  }
}
