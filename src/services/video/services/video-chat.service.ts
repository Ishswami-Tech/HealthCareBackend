/**
 * Video Chat Service
 * @class VideoChatService
 * @description Real-time chat messaging during video consultations
 * Supports text, images, documents, prescriptions, and file sharing
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
import type { SendChatMessageDto } from '@dtos/video.dto';
import {
  getVideoChatMessageDelegate,
  getVideoConsultationDelegate,
} from '@core/types/video-database.types';
import type { PrismaTransactionClient } from '@core/types/database.types';

export interface ChatMessage {
  id: string;
  consultationId: string;
  userId: string;
  message: string;
  messageType: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'PRESCRIPTION' | 'FILE';
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  isEdited: boolean;
  isDeleted: boolean;
  replyToId?: string;
  createdAt: Date;
  updatedAt: Date;
  user?: {
    id: string;
    name: string;
    email: string;
    avatar?: string;
  };
}

export type SendMessageDto = SendChatMessageDto;

export interface TypingIndicator {
  consultationId: string;
  userId: string;
  isTyping: boolean;
  timestamp: Date;
}

/**
 * Database chat message model structure
 */
interface VideoChatMessageDbModel {
  id: string;
  consultationId: string;
  userId: string;
  message: string;
  messageType: string;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  fileType?: string | null;
  isEdited: boolean;
  isDeleted: boolean;
  replyToId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  user?: {
    id: string;
    name: string;
    email: string;
    profilePicture?: string | null;
  } | null;
}

@Injectable()
export class VideoChatService {
  private readonly CHAT_CACHE_TTL = 3600; // 1 hour
  private readonly TYPING_TIMEOUT = 5000; // 5 seconds
  private typingUsers: Map<string, NodeJS.Timeout> = new Map();

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
   * Send a chat message
   */
  async sendMessage(dto: SendMessageDto): Promise<ChatMessage> {
    try {
      // Validate consultation exists and user is participant
      await this.validateParticipant(dto.consultationId, dto.userId);

      // Create message in database
      const messageResult = await this.databaseService.executeHealthcareWrite(
        async (client: PrismaTransactionClient) => {
          const delegate = getVideoChatMessageDelegate(client);
          const result = (await delegate.create({
            data: {
              consultationId: dto.consultationId,
              userId: dto.userId,
              message: dto.message,
              messageType: dto.messageType || 'TEXT',
              fileUrl: dto.fileUrl,
              fileName: dto.fileName,
              fileSize: dto.fileSize,
              fileType: dto.fileType,
              replyToId: dto.replyToId,
            },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  profilePicture: true,
                },
              },
            },
          })) as VideoChatMessageDbModel;
          return result;
        },
        {
          userId: dto.userId,
          userRole: 'PATIENT',
          clinicId: '',
          operation: 'CREATE_CHAT_MESSAGE',
          resourceType: 'VIDEO_CHAT_MESSAGE',
          resourceId: dto.consultationId,
          timestamp: new Date(),
        }
      );

      // Cache message
      const cacheKey = `chat:message:${messageResult.id}`;
      await this.cacheService.set(cacheKey, messageResult, this.CHAT_CACHE_TTL);

      // Emit real-time message via Socket.IO
      const mappedMessage = this.mapToChatMessage(messageResult);
      const socketData: Record<
        string,
        string | number | boolean | null | Record<string, string | number | boolean | null>
      > = {
        id: mappedMessage.id,
        consultationId: mappedMessage.consultationId,
        userId: mappedMessage.userId,
        message: mappedMessage.message,
        messageType: mappedMessage.messageType,
        createdAt: mappedMessage.createdAt.toISOString(),
      };

      if (mappedMessage.fileUrl) {
        socketData['fileUrl'] = mappedMessage.fileUrl;
      }
      if (mappedMessage.fileName) {
        socketData['fileName'] = mappedMessage.fileName;
      }
      if (mappedMessage.fileSize !== undefined) {
        socketData['fileSize'] = mappedMessage.fileSize;
      }
      if (mappedMessage.fileType) {
        socketData['fileType'] = mappedMessage.fileType;
      }
      if (mappedMessage.replyToId) {
        socketData['replyToId'] = mappedMessage.replyToId;
      }
      if (mappedMessage.user) {
        socketData['user'] = {
          id: mappedMessage.user.id,
          name: mappedMessage.user.name,
          email: mappedMessage.user.email,
          ...(mappedMessage.user.avatar && { avatar: mappedMessage.user.avatar }),
        };
      }

      this.socketService.sendToRoom(
        `consultation_${dto.consultationId}`,
        'chat_message',
        socketData
      );

      // Emit event
      await this.eventService.emitEnterprise('video.chat.message.sent', {
        eventId: `chat-message-${messageResult.id}-${Date.now()}`,
        eventType: 'video.chat.message.sent',
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: new Date().toISOString(),
        source: 'VideoChatService',
        version: '1.0.0',
        payload: {
          messageId: messageResult.id,
          consultationId: dto.consultationId,
          userId: dto.userId,
          messageType: messageResult.messageType,
        },
      });

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Chat message sent: ${messageResult.id}`,
        'VideoChatService',
        {
          messageId: messageResult.id,
          consultationId: dto.consultationId,
          userId: dto.userId,
          messageType: messageResult.messageType,
        }
      );

      return mappedMessage;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to send chat message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoChatService',
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
   * Get chat message history
   */
  async getMessageHistory(
    consultationId: string,
    limit: number = 50,
    before?: string
  ): Promise<ChatMessage[]> {
    try {
      const cacheKey = `chat:history:${consultationId}:${limit}:${before || 'latest'}`;
      const cached = await this.cacheService.get<ChatMessage[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const messagesResult = await this.databaseService.executeHealthcareRead(
        async (client: PrismaTransactionClient) => {
          const delegate = getVideoChatMessageDelegate(client);
          const result = (await delegate.findMany({
            where: {
              consultationId,
              isDeleted: false,
              ...(before && { createdAt: { lt: new Date(before) } }),
            } as unknown,
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  profilePicture: true,
                },
              },
            } as unknown,
            orderBy: {
              createdAt: 'desc',
            } as unknown,
            take: limit,
          })) as VideoChatMessageDbModel[];
          return result;
        }
      );

      const result = messagesResult.map(msg => this.mapToChatMessage(msg)).reverse();

      // Cache result
      await this.cacheService.set(cacheKey, result, this.CHAT_CACHE_TTL);

      return result;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get message history: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoChatService',
        {
          error: error instanceof Error ? error.message : String(error),
          consultationId,
        }
      );
      throw error;
    }
  }

  /**
   * Update typing indicator
   */
  updateTypingIndicator(consultationId: string, userId: string, isTyping: boolean): void {
    try {
      // Clear existing timeout
      const timeoutKey = `${consultationId}:${userId}`;
      const existingTimeout = this.typingUsers.get(timeoutKey);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      if (isTyping) {
        // Set timeout to auto-clear typing indicator
        const timeout = setTimeout(() => {
          this.typingUsers.delete(timeoutKey);
          this.socketService.sendToRoom(`consultation_${consultationId}`, 'typing_indicator', {
            consultationId,
            userId,
            isTyping: false,
            timestamp: new Date().toISOString(),
          });
        }, this.TYPING_TIMEOUT);

        this.typingUsers.set(timeoutKey, timeout);
      } else {
        this.typingUsers.delete(timeoutKey);
      }

      // Emit typing indicator via Socket.IO
      this.socketService.sendToRoom(`consultation_${consultationId}`, 'typing_indicator', {
        consultationId,
        userId,
        isTyping,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to update typing indicator: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoChatService',
        {
          error: error instanceof Error ? error.message : String(error),
          consultationId,
          userId,
        }
      );
    }
  }

  /**
   * Edit a message
   */
  async editMessage(messageId: string, userId: string, newMessage: string): Promise<ChatMessage> {
    try {
      const messageResult = await this.databaseService.executeHealthcareWrite(
        async (client: PrismaTransactionClient) => {
          const delegate = getVideoChatMessageDelegate(client);
          const existing = (await delegate.findUnique({
            where: { id: messageId },
          })) as VideoChatMessageDbModel | null;

          if (!existing) {
            throw new NotFoundException(`Message ${messageId} not found`);
          }

          if (existing.userId !== userId) {
            throw new HealthcareError(
              ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
              'You can only edit your own messages',
              undefined,
              { messageId, userId },
              'VideoChatService.editMessage'
            );
          }

          const result = (await delegate.update({
            where: { id: messageId },
            data: {
              message: newMessage,
              isEdited: true,
            },
          })) as VideoChatMessageDbModel;
          return result;
        },
        {
          userId,
          userRole: 'PATIENT',
          clinicId: '',
          operation: 'UPDATE_CHAT_MESSAGE',
          resourceType: 'VIDEO_CHAT_MESSAGE',
          resourceId: messageId,
          timestamp: new Date(),
        }
      );

      // Emit update via Socket.IO
      this.socketService.sendToRoom(
        `consultation_${messageResult.consultationId}`,
        'chat_message_updated',
        {
          id: messageResult.id,
          message: messageResult.message,
          isEdited: messageResult.isEdited,
          updatedAt: messageResult.updatedAt.toISOString(),
        }
      );

      return this.mapToChatMessage(messageResult);
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to edit message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoChatService',
        {
          error: error instanceof Error ? error.message : String(error),
          messageId,
          userId,
        }
      );
      throw error;
    }
  }

  /**
   * Delete a message
   */
  async deleteMessage(messageId: string, userId: string): Promise<void> {
    try {
      const messageResult = await this.databaseService.executeHealthcareWrite(
        async (client: PrismaTransactionClient) => {
          const delegate = getVideoChatMessageDelegate(client);
          const existing = (await delegate.findUnique({
            where: { id: messageId },
          })) as VideoChatMessageDbModel | null;

          if (!existing) {
            throw new NotFoundException(`Message ${messageId} not found`);
          }

          if (existing.userId !== userId) {
            throw new HealthcareError(
              ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
              'You can only delete your own messages',
              undefined,
              { messageId, userId },
              'VideoChatService.deleteMessage'
            );
          }

          const result = (await delegate.update({
            where: { id: messageId },
            data: {
              isDeleted: true,
            },
          })) as VideoChatMessageDbModel;
          return result;
        },
        {
          userId,
          userRole: 'PATIENT',
          clinicId: '',
          operation: 'DELETE_CHAT_MESSAGE',
          resourceType: 'VIDEO_CHAT_MESSAGE',
          resourceId: messageId,
          timestamp: new Date(),
        }
      );

      // Emit deletion via Socket.IO
      this.socketService.sendToRoom(
        `consultation_${messageResult.consultationId}`,
        'chat_message_deleted',
        {
          id: messageResult.id,
          consultationId: messageResult.consultationId,
        }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to delete message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoChatService',
        {
          error: error instanceof Error ? error.message : String(error),
          messageId,
          userId,
        }
      );
      throw error;
    }
  }

  /**
   * Validate user is a participant in the consultation
   */
  private async validateParticipant(consultationId: string, userId: string): Promise<void> {
    const consultation = await this.databaseService.executeHealthcareRead(
      async (client: PrismaTransactionClient) => {
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
      (consultation.participants && consultation.participants.some(p => p.userId === userId));

    if (!isParticipant) {
      throw new HealthcareError(
        ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
        'User is not a participant in this consultation',
        undefined,
        { consultationId, userId },
        'VideoChatService.validateParticipant'
      );
    }
  }

  /**
   * Map database model to ChatMessage interface
   */
  private mapToChatMessage(message: VideoChatMessageDbModel): ChatMessage {
    const result: ChatMessage = {
      id: message.id,
      consultationId: message.consultationId,
      userId: message.userId,
      message: message.message,
      messageType: message.messageType as ChatMessage['messageType'],
      isEdited: message.isEdited,
      isDeleted: message.isDeleted,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };

    if (message.fileUrl) {
      result.fileUrl = message.fileUrl;
    }
    if (message.fileName) {
      result.fileName = message.fileName;
    }
    if (message.fileSize !== undefined && message.fileSize !== null) {
      result.fileSize = message.fileSize;
    }
    if (message.fileType) {
      result.fileType = message.fileType;
    }
    if (message.replyToId) {
      result.replyToId = message.replyToId;
    }
    if (message.user) {
      result.user = {
        id: message.user.id,
        name: message.user.name,
        email: message.user.email,
        ...(message.user.profilePicture && { avatar: message.user.profilePicture }),
      };
    }

    return result;
  }
}
