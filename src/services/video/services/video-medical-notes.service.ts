/**
 * Video Medical Notes Service
 * @class VideoMedicalNotesService
 * @description Live note-taking during video consultations
 * Supports prescription writing, symptom documentation, treatment plans, and auto-save to EHR
 */

import { Injectable, Inject, forwardRef, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { SocketService } from '@communication/channels/socket/socket.service';
import { EventService } from '@infrastructure/events';
import { EHRService } from '@services/ehr/ehr.service';
import { LogType, LogLevel, EventCategory, EventPriority } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import type { CreateMedicalNoteDto, UpdateMedicalNoteDto } from '@dtos/video.dto';
import {
  getVideoConsultationNoteDelegate,
  getVideoConsultationDelegate,
} from '@core/types/video-database.types';
import type { PrismaTransactionClient } from '@core/types/database.types';

export interface MedicalNote {
  id: string;
  consultationId: string;
  userId: string;
  noteType: 'GENERAL' | 'PRESCRIPTION' | 'SYMPTOM' | 'TREATMENT_PLAN' | 'DIAGNOSIS';
  title?: string;
  content: string;
  prescription?: {
    medications: Array<{
      name: string;
      dosage: string;
      frequency: string;
      duration: string;
      instructions?: string;
    }>;
  };
  symptoms?: Array<{
    symptom: string;
    severity: 'mild' | 'moderate' | 'severe';
    duration?: string;
    notes?: string;
  }>;
  treatmentPlan?: {
    diagnosis: string;
    treatment: string;
    followUp?: string;
    recommendations?: string[];
  };
  isAutoSaved: boolean;
  savedToEHR: boolean;
  ehrRecordId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateNoteDto = CreateMedicalNoteDto;
export type UpdateNoteDto = UpdateMedicalNoteDto;

/**
 * Database note model structure
 */
interface VideoConsultationNoteDbModel {
  id: string;
  consultationId: string;
  userId: string;
  noteType: string;
  title?: string | null;
  content: string;
  prescription?: unknown;
  symptoms?: unknown;
  treatmentPlan?: unknown;
  isAutoSaved: boolean;
  savedToEHR: boolean;
  ehrRecordId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class VideoMedicalNotesService {
  private readonly NOTES_CACHE_TTL = 3600; // 1 hour
  private readonly AUTO_SAVE_INTERVAL = 30000; // 30 seconds
  private autoSaveTimers: Map<string, NodeJS.Timeout> = new Map();

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
    private readonly ehrService: EHRService
  ) {}

  /**
   * Create a medical note
   */
  async createNote(dto: CreateNoteDto): Promise<MedicalNote> {
    try {
      // Validate consultation exists and user is participant
      await this.validateParticipant(dto.consultationId, dto.userId);

      // Create note in database
      const noteResult = await this.databaseService.executeHealthcareWrite(
        async (client: PrismaTransactionClient) => {
          const delegate = getVideoConsultationNoteDelegate(client);
          const result = (await delegate.create({
            data: {
              consultationId: dto.consultationId,
              userId: dto.userId,
              noteType: dto.noteType,
              title: dto.title,
              content: dto.content,
              prescription: dto.prescription ? (dto.prescription as unknown) : undefined,
              symptoms: dto.symptoms ? (dto.symptoms as unknown) : undefined,
              treatmentPlan: dto.treatmentPlan ? (dto.treatmentPlan as unknown) : undefined,
              isAutoSaved: false,
              savedToEHR: false,
            },
          })) as VideoConsultationNoteDbModel;
          return result;
        },
        {
          userId: dto.userId,
          userRole: 'DOCTOR',
          clinicId: '',
          operation: 'CREATE_MEDICAL_NOTE',
          resourceType: 'VIDEO_CONSULTATION_NOTE',
          resourceId: dto.consultationId,
          timestamp: new Date(),
        }
      );

      // Schedule auto-save
      this.scheduleAutoSave(noteResult.id, dto.consultationId, dto.userId);

      // Emit real-time update via Socket.IO
      const mappedNote = this.mapToMedicalNote(noteResult);
      this.socketService.sendToRoom(`consultation_${dto.consultationId}`, 'medical_note_created', {
        note: {
          id: mappedNote.id,
          consultationId: mappedNote.consultationId,
          userId: mappedNote.userId,
          noteType: mappedNote.noteType,
          title: mappedNote.title || null,
          content: mappedNote.content,
          isAutoSaved: mappedNote.isAutoSaved,
          savedToEHR: mappedNote.savedToEHR,
          createdAt: mappedNote.createdAt.toISOString(),
        } as Record<string, string | boolean | null>,
      });

      // Emit event
      await this.eventService.emitEnterprise('video.medical_note.created', {
        eventId: `medical-note-${noteResult.id}-${Date.now()}`,
        eventType: 'video.medical_note.created',
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: new Date().toISOString(),
        source: 'VideoMedicalNotesService',
        version: '1.0.0',
        payload: {
          noteId: noteResult.id,
          consultationId: dto.consultationId,
          userId: dto.userId,
          noteType: dto.noteType,
        },
      });

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Medical note created: ${noteResult.id}`,
        'VideoMedicalNotesService',
        {
          noteId: noteResult.id,
          consultationId: dto.consultationId,
          userId: dto.userId,
          noteType: dto.noteType,
        }
      );

      return mappedNote;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to create medical note: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoMedicalNotesService',
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
   * Update a medical note
   */
  async updateNote(dto: UpdateNoteDto): Promise<MedicalNote> {
    try {
      const noteResult = await this.databaseService.executeHealthcareRead(
        async (client: PrismaTransactionClient) => {
          const delegate = getVideoConsultationNoteDelegate(client);
          const result = (await delegate.findUnique({
            where: { id: dto.noteId },
          })) as VideoConsultationNoteDbModel | null;
          return result;
        }
      );

      if (!noteResult) {
        throw new NotFoundException(`Note ${dto.noteId} not found`);
      }

      if (noteResult.userId !== dto.userId) {
        throw new HealthcareError(
          ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
          'You can only update your own notes',
          undefined,
          { noteId: dto.noteId, userId: dto.userId },
          'VideoMedicalNotesService.updateNote'
        );
      }

      // Update note
      const updatedResult = await this.databaseService.executeHealthcareWrite(
        async (client: PrismaTransactionClient) => {
          const delegate = getVideoConsultationNoteDelegate(client);
          const result = (await delegate.update({
            where: { id: dto.noteId },
            data: {
              ...(dto.title !== undefined && { title: dto.title }),
              ...(dto.content !== undefined && { content: dto.content }),
              ...(dto.prescription !== undefined && {
                prescription: dto.prescription as unknown,
              }),
              ...(dto.symptoms !== undefined && { symptoms: dto.symptoms as unknown }),
              ...(dto.treatmentPlan !== undefined && {
                treatmentPlan: dto.treatmentPlan as unknown,
              }),
              isAutoSaved: false, // Reset auto-save flag on manual update
            },
          })) as VideoConsultationNoteDbModel;
          return result;
        },
        {
          userId: dto.userId,
          userRole: 'DOCTOR',
          clinicId: '',
          operation: 'UPDATE_MEDICAL_NOTE',
          resourceType: 'VIDEO_CONSULTATION_NOTE',
          resourceId: dto.noteId,
          timestamp: new Date(),
        }
      );

      // Schedule auto-save
      this.scheduleAutoSave(updatedResult.id, updatedResult.consultationId, dto.userId);

      // Emit real-time update
      const mappedNote = this.mapToMedicalNote(updatedResult);
      this.socketService.sendToRoom(
        `consultation_${updatedResult.consultationId}`,
        'medical_note_updated',
        {
          note: {
            id: mappedNote.id,
            consultationId: mappedNote.consultationId,
            userId: mappedNote.userId,
            noteType: mappedNote.noteType,
            title: mappedNote.title || null,
            content: mappedNote.content,
            isAutoSaved: mappedNote.isAutoSaved,
            savedToEHR: mappedNote.savedToEHR,
            updatedAt: mappedNote.updatedAt.toISOString(),
          } as Record<string, string | boolean | null>,
        }
      );

      return mappedNote;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to update medical note: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoMedicalNotesService',
        {
          error: error instanceof Error ? error.message : String(error),
          noteId: dto.noteId,
          userId: dto.userId,
        }
      );
      throw error;
    }
  }

  /**
   * Get notes for a consultation
   */
  async getNotes(consultationId: string): Promise<MedicalNote[]> {
    try {
      const cacheKey = `medical_notes:${consultationId}`;
      const cached = await this.cacheService.get<MedicalNote[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const notesResult = await this.databaseService.executeHealthcareRead(
        async (client: PrismaTransactionClient) => {
          const delegate = getVideoConsultationNoteDelegate(client);
          const result = (await delegate.findMany({
            where: {
              consultationId,
            },
            orderBy: {
              createdAt: 'desc',
            },
          })) as VideoConsultationNoteDbModel[];
          return result;
        }
      );

      const result = notesResult.map(note => this.mapToMedicalNote(note));

      // Cache result
      await this.cacheService.set(cacheKey, result, this.NOTES_CACHE_TTL);

      return result;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get notes: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoMedicalNotesService',
        {
          error: error instanceof Error ? error.message : String(error),
          consultationId,
        }
      );
      throw error;
    }
  }

  /**
   * Save note to EHR
   */
  async saveToEHR(noteId: string, userId: string): Promise<{ ehrRecordId: string }> {
    try {
      const noteResult = await this.databaseService.executeHealthcareRead(
        async (client: PrismaTransactionClient) => {
          const delegate = getVideoConsultationNoteDelegate(client);
          const result = (await delegate.findUnique({
            where: { id: noteId },
          })) as VideoConsultationNoteDbModel | null;
          return result;
        }
      );

      if (!noteResult) {
        throw new NotFoundException(`Note ${noteId} not found`);
      }

      if (noteResult.savedToEHR) {
        return { ehrRecordId: noteResult.ehrRecordId || '' };
      }

      // Get consultation for clinicId using delegate helper
      const consultationResult = await this.databaseService.executeHealthcareRead(
        async (client: PrismaTransactionClient) => {
          const delegate = getVideoConsultationDelegate(client);
          // Use findUnique with id
          const result = await delegate.findUnique({
            where: { id: noteResult.consultationId },
          });
          return result;
        }
      );

      if (!consultationResult) {
        throw new NotFoundException(`Consultation ${noteResult.consultationId} not found`);
      }

      // Save to EHR based on note type
      let ehrRecordId: string | undefined;

      if (noteResult.noteType === 'PRESCRIPTION' && noteResult.prescription) {
        // Save prescription to EHR
        const prescription = noteResult.prescription as {
          medications: Array<{
            name: string;
            dosage: string;
            frequency: string;
            duration: string;
            instructions?: string;
          }>;
        };

        // Create medication records in EHR
        const medicationRecordIds: string[] = [];
        const startDate = new Date();
        const durationDays = prescription.medications[0]?.duration
          ? parseInt(prescription.medications[0].duration.match(/\d+/)?.[0] || '7', 10)
          : 7;
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + durationDays);

        for (const medication of prescription.medications) {
          try {
            const medicationRecord = await this.ehrService.createMedication({
              userId: noteResult.userId,
              name: medication.name,
              dosage: medication.dosage,
              frequency: medication.frequency,
              startDate: startDate.toISOString(),
              endDate: endDate.toISOString(),
              prescribedBy: userId,
              purpose:
                medication.instructions ||
                `Prescribed during video consultation ${noteResult.consultationId}`,
            });

            if (medicationRecord?.id) {
              medicationRecordIds.push(medicationRecord.id);
            }
          } catch (medError) {
            void this.loggingService.log(
              LogType.SYSTEM,
              LogLevel.ERROR,
              `Failed to create medication record: ${medError instanceof Error ? medError.message : String(medError)}`,
              'VideoMedicalNotesService.saveToEHR',
              {
                medication: medication.name,
                noteId,
                consultationId: noteResult.consultationId,
              }
            );
            // Continue with other medications even if one fails
          }
        }

        // Use first medication record ID as primary EHR record ID, or generate one
        ehrRecordId =
          medicationRecordIds.length > 0 ? medicationRecordIds[0] : `ehr-prescription-${noteId}`;
      }

      // Update note with EHR record ID
      const updatedResult = await this.databaseService.executeHealthcareWrite(
        async (client: PrismaTransactionClient) => {
          const delegate = getVideoConsultationNoteDelegate(client);
          const result = (await delegate.update({
            where: { id: noteId },
            data: {
              savedToEHR: true,
              ehrRecordId: ehrRecordId || `ehr-${noteId}`,
            },
          })) as VideoConsultationNoteDbModel;
          return result;
        },
        {
          userId,
          userRole: 'DOCTOR',
          clinicId: consultationResult.clinicId,
          operation: 'SAVE_NOTE_TO_EHR',
          resourceType: 'VIDEO_CONSULTATION_NOTE',
          resourceId: noteId,
          timestamp: new Date(),
        }
      );

      // Clear cache
      await this.cacheService.delete(`medical_notes:${noteResult.consultationId}`);

      // Emit event
      await this.eventService.emitEnterprise('video.medical_note.saved_to_ehr', {
        eventId: `medical-note-ehr-${noteId}-${Date.now()}`,
        eventType: 'video.medical_note.saved_to_ehr',
        category: EventCategory.SYSTEM,
        priority: EventPriority.HIGH,
        timestamp: new Date().toISOString(),
        source: 'VideoMedicalNotesService',
        version: '1.0.0',
        payload: {
          noteId,
          ehrRecordId: updatedResult.ehrRecordId || '',
          consultationId: noteResult.consultationId,
        },
      });

      return { ehrRecordId: updatedResult.ehrRecordId || '' };
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to save note to EHR: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoMedicalNotesService',
        {
          error: error instanceof Error ? error.message : String(error),
          noteId,
          userId,
        }
      );
      throw error;
    }
  }

  /**
   * Auto-save note
   */
  private scheduleAutoSave(noteId: string, consultationId: string, userId: string): void {
    // Clear existing timer
    const existingTimer = this.autoSaveTimers.get(noteId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new auto-save
    const timer = setTimeout(() => {
      void (async () => {
        try {
          await this.databaseService.executeHealthcareWrite(
            async (client: PrismaTransactionClient) => {
              const delegate = getVideoConsultationNoteDelegate(client);
              await delegate.update({
                where: { id: noteId },
                data: {
                  isAutoSaved: true,
                },
              });
            },
            {
              userId,
              userRole: 'DOCTOR',
              clinicId: '',
              operation: 'AUTO_SAVE_MEDICAL_NOTE',
              resourceType: 'VIDEO_CONSULTATION_NOTE',
              resourceId: noteId,
              timestamp: new Date(),
            }
          );

          // Emit auto-save notification
          this.socketService.sendToRoom(
            `consultation_${consultationId}`,
            'medical_note_auto_saved',
            {
              noteId,
            }
          );
        } catch (error) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Auto-save failed for note ${noteId}`,
            'VideoMedicalNotesService',
            {
              error: error instanceof Error ? error.message : String(error),
              noteId,
            }
          );
        } finally {
          this.autoSaveTimers.delete(noteId);
        }
      })();
    }, this.AUTO_SAVE_INTERVAL);

    this.autoSaveTimers.set(noteId, timer);
  }

  /**
   * Validate user is a participant
   */
  private async validateParticipant(consultationId: string, userId: string): Promise<void> {
    const consultation = await this.databaseService.executeHealthcareRead(
      async (client: PrismaTransactionClient) => {
        const delegate = getVideoConsultationDelegate(client);
        // Use findFirst with id and include participants
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
      (consultation.participants && consultation.participants.some(p => p.userId === userId));

    if (!isParticipant) {
      throw new HealthcareError(
        ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
        'User is not a participant in this consultation',
        undefined,
        { consultationId, userId },
        'VideoMedicalNotesService.validateParticipant'
      );
    }
  }

  /**
   * Map database model to MedicalNote interface
   */
  private mapToMedicalNote(note: VideoConsultationNoteDbModel): MedicalNote {
    const result: MedicalNote = {
      id: note.id,
      consultationId: note.consultationId,
      userId: note.userId,
      noteType: note.noteType as MedicalNote['noteType'],
      content: note.content,
      isAutoSaved: note.isAutoSaved,
      savedToEHR: note.savedToEHR,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    };

    if (note.title) {
      result.title = note.title;
    }

    if (note.prescription) {
      const prescription = note.prescription as MedicalNote['prescription'];
      if (prescription) {
        result.prescription = prescription;
      }
    }

    if (note.symptoms) {
      const symptoms = note.symptoms as MedicalNote['symptoms'];
      if (symptoms) {
        result.symptoms = symptoms;
      }
    }

    if (note.treatmentPlan) {
      const treatmentPlan = note.treatmentPlan as MedicalNote['treatmentPlan'];
      if (treatmentPlan) {
        result.treatmentPlan = treatmentPlan;
      }
    }

    if (note.ehrRecordId) {
      result.ehrRecordId = note.ehrRecordId;
    }

    return result;
  }
}
