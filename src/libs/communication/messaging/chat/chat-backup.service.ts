import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@config';
import * as admin from 'firebase-admin';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

export interface ChatMessage {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  timestamp: number;
  type: 'text' | 'image' | 'file' | 'audio' | 'video';
  messageHash?: string;
  metadata?: {
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    duration?: number;
    threadId?: string;
    replyToMessageId?: string;
  };
}

export interface ChatMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface MessageHistoryResult {
  success: boolean;
  messages?: Record<string, ChatMessage>;
  count?: number;
  error?: string;
}

export interface ConversationMessage {
  id: string;
  senderId: string;
  timestamp: number;
  type: 'text' | 'image' | 'file' | 'audio' | 'video';
}

export interface ChatBackupStats {
  totalMessages: number;
  messagesLast24h: number;
  messagesLast7d: number;
  totalStorageUsed: number;
}

interface FirebaseMessageData {
  senderId: string;
  receiverId: string;
  content: string;
  timestamp: number;
  type: 'text' | 'image' | 'file' | 'audio' | 'video';
  messageHash?: string;
  metadata?: Record<string, unknown>;
  conversationId?: string;
}

/**
 * Chat Backup Service
 *
 * Handles chat message backup and synchronization using Firebase Realtime Database.
 *
 * ARCHITECTURE:
 * - Uses Firebase Realtime Database for chat message storage (separate from PostgreSQL)
 * - Follows the same patterns as database infrastructure services
 * - All operations use LoggingService for HIPAA-compliant logging
 * - Implements conversation-based and user-based indexing for efficient queries
 * - Automatic cleanup of old messages based on retention policy
 *
 * Note: This service uses Firebase Realtime Database (not PostgreSQL) as chat messages
 * require real-time synchronization and different storage characteristics than structured data.
 *
 * @class ChatBackupService
 * @implements {OnModuleInit}
 */
@Injectable()
export class ChatBackupService implements OnModuleInit {
  private database: admin.database.Database | null = null;
  private isInitialized = false;
  private readonly maxMessageHistory = 10000; // Limit per user conversation
  private readonly messageRetentionDays = 365; // Keep messages for 1 year

  constructor(
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService
  ) {}

  onModuleInit(): void {
    this.initializeFirebaseDatabase();
  }

  private initializeFirebaseDatabase(): void {
    try {
      const databaseUrl =
        this.configService?.get<string>('FIREBASE_DATABASE_URL') ||
        process.env['FIREBASE_DATABASE_URL'];
      const projectId =
        this.configService?.get<string>('FIREBASE_PROJECT_ID') ||
        process.env['FIREBASE_PROJECT_ID'];
      const privateKey =
        this.configService?.get<string>('FIREBASE_PRIVATE_KEY') ||
        process.env['FIREBASE_PRIVATE_KEY'];
      const clientEmail =
        this.configService?.get<string>('FIREBASE_CLIENT_EMAIL') ||
        process.env['FIREBASE_CLIENT_EMAIL'];

      if (!databaseUrl || !projectId || !privateKey || !clientEmail) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Firebase Realtime Database credentials not provided, chat backup service will be disabled',
          'ChatBackupService'
        );
        this.isInitialized = false;
        return;
      }

      // Initialize Firebase Admin SDK if not already initialized
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            privateKey: privateKey.replace(/\\n/g, '\n'),
            clientEmail,
          }),
          databaseURL: databaseUrl,
        });
      }

      this.database = admin.database();
      this.isInitialized = true;
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Firebase Realtime Database chat backup service initialized successfully',
        'ChatBackupService'
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Failed to initialize Firebase Realtime Database',
        'ChatBackupService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      this.isInitialized = false;
    }
  }

  async backupMessage(messageData: ChatMessage): Promise<ChatMessageResult> {
    if (!this.isInitialized || !this.database) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Chat backup service is not initialized, skipping message backup',
        'ChatBackupService'
      );
      return { success: false, error: 'Service not initialized' };
    }

    try {
      // Validate message data
      if (!this.validateMessageData(messageData)) {
        return { success: false, error: 'Invalid message data' };
      }

      // Create conversation ID (consistent ordering for both participants)
      const conversationId = this.createConversationId(
        messageData.senderId,
        messageData.receiverId
      );

      // Prepare message for storage
      const messageToStore = {
        ...messageData,
        backedUpAt: Date.now(),
        conversationId,
        messageHash: this.generateMessageHash(messageData),
      };

      // Store message in multiple paths for different query patterns
      const updates: Record<string, unknown> = {};

      // Main message storage
      updates[`messages/${messageData.id}`] = messageToStore;

      // Conversation-based storage for easy retrieval
      updates[`conversations/${conversationId}/${messageData.id}`] = {
        id: messageData.id,
        senderId: messageData.senderId,
        timestamp: messageData.timestamp,
        type: messageData.type,
      };

      // User-based message index
      updates[`user_messages/${messageData.senderId}/${messageData.id}`] = {
        conversationId,
        timestamp: messageData.timestamp,
        receiverId: messageData.receiverId,
      };

      updates[`user_messages/${messageData.receiverId}/${messageData.id}`] = {
        conversationId,
        timestamp: messageData.timestamp,
        senderId: messageData.senderId,
      };

      await this.database.ref().update(updates);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Message backed up successfully',
        'ChatBackupService',
        {
          messageId: messageData.id,
          conversationId,
          senderId: messageData.senderId,
          receiverId: messageData.receiverId,
          type: messageData.type,
        }
      );

      // Clean up old messages if needed
      await this.cleanupOldMessages(conversationId);

      return { success: true, messageId: messageData.id };
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Failed to backup message',
        'ChatBackupService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          messageId: messageData.id,
          senderId: messageData.senderId,
          receiverId: messageData.receiverId,
        }
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getMessageHistory(
    userId: string,
    conversationPartnerId: string,
    limit: number = 50,
    startAfter?: number
  ): Promise<MessageHistoryResult> {
    if (!this.isInitialized || !this.database) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Chat backup service is not initialized',
        'ChatBackupService'
      );
      return { success: false, error: 'Service not initialized' };
    }

    try {
      const conversationId = this.createConversationId(userId, conversationPartnerId);
      let query = this.database
        .ref(`conversations/${conversationId}`)
        .orderByChild('timestamp')
        .limitToLast(limit);

      if (startAfter) {
        query = query.endBefore(startAfter);
      }

      const snapshot = await query.once('value');
      const rawConversationMessages = snapshot.val() as Record<string, ConversationMessage> | null;
      const conversationMessages: Record<string, unknown> = rawConversationMessages || {};

      // Get full message details
      const messageIds = Object.keys(conversationMessages);
      const messages: Record<string, ChatMessage> = {};

      if (messageIds.length > 0) {
        const fullMessagesPromises = messageIds.map(async messageId => {
          const messageSnapshot = await this.database!.ref(`messages/${messageId}`).once('value');
          const messageData = messageSnapshot.val() as FirebaseMessageData | null;
          return {
            id: messageId,
            data: messageData,
          };
        });

        const fullMessagesResults = await Promise.all(fullMessagesPromises);

        fullMessagesResults.forEach(({ id, data }) => {
          if (data) {
            messages[id] = { ...data, id } as ChatMessage;
          }
        });
      }

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        'Message history retrieved',
        'ChatBackupService',
        {
          conversationId,
          userId,
          conversationPartnerId,
          messageCount: Object.keys(messages).length,
          limit,
        }
      );

      return {
        success: true,
        messages,
        count: Object.keys(messages).length,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Failed to get message history',
        'ChatBackupService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          userId,
          conversationPartnerId,
          limit,
        }
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async syncMessages(userId: string, lastSyncTimestamp?: number): Promise<MessageHistoryResult> {
    if (!this.isInitialized || !this.database) {
      return { success: false, error: 'Service not initialized' };
    }

    try {
      let query = this.database.ref(`user_messages/${userId}`).orderByChild('timestamp');

      if (lastSyncTimestamp) {
        query = query.startAfter(lastSyncTimestamp);
      }

      const snapshot = await query.limitToLast(1000).once('value');
      const rawUserMessages = snapshot.val() as Record<string, unknown> | null;
      const userMessages: Record<string, unknown> = rawUserMessages || {};

      const messages: Record<string, ChatMessage> = {};
      const messageIds = Object.keys(userMessages);

      if (messageIds.length > 0) {
        const fullMessagesPromises = messageIds.map(async messageId => {
          const messageSnapshot = await this.database!.ref(`messages/${messageId}`).once('value');
          const messageData = messageSnapshot.val() as FirebaseMessageData | null;
          return {
            id: messageId,
            data: messageData,
          };
        });

        const fullMessagesResults = await Promise.all(fullMessagesPromises);

        fullMessagesResults.forEach(({ id, data }) => {
          if (data) {
            messages[id] = { ...data, id } as ChatMessage;
          }
        });
      }

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        'Messages synced for user',
        'ChatBackupService',
        {
          userId,
          messageCount: Object.keys(messages).length,
          lastSyncTimestamp,
        }
      );

      return {
        success: true,
        messages,
        count: Object.keys(messages).length,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Failed to sync messages',
        'ChatBackupService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          userId,
          lastSyncTimestamp,
        }
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async deleteMessage(messageId: string, userId: string): Promise<boolean> {
    if (!this.isInitialized || !this.database) {
      return false;
    }

    try {
      // Get message to find conversation details
      const messageSnapshot = await this.database.ref(`messages/${messageId}`).once('value');
      const messageData = messageSnapshot.val() as FirebaseMessageData | null;

      if (!messageData) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Message not found for deletion',
          'ChatBackupService',
          { messageId }
        );
        return false;
      }

      // Verify user is authorized to delete this message
      if (messageData.senderId !== userId) {
        void this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'Unauthorized message deletion attempt',
          'ChatBackupService',
          {
            messageId,
            userId,
            messageSenderId: messageData.senderId,
          }
        );
        return false;
      }

      const conversationId = messageData.conversationId;

      // Remove message from all storage paths
      const updates: Record<string, unknown> = {};
      updates[`messages/${messageId}`] = null;
      updates[`conversations/${conversationId}/${messageId}`] = null;
      updates[`user_messages/${messageData.senderId}/${messageId}`] = null;
      updates[`user_messages/${messageData.receiverId}/${messageId}`] = null;

      await this.database.ref().update(updates);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Message deleted from backup',
        'ChatBackupService',
        {
          messageId,
          userId,
          conversationId,
        }
      );

      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Failed to delete message',
        'ChatBackupService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          messageId,
          userId,
        }
      );
      return false;
    }
  }

  async getBackupStats(): Promise<ChatBackupStats | null> {
    if (!this.isInitialized || !this.database) {
      return null;
    }

    try {
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

      // Get total message count
      const totalSnapshot = await this.database.ref('messages').once('value');
      const totalMessages = totalSnapshot.numChildren();

      // Get recent message counts (this is a simplified approach)
      const messagesSnapshot = await this.database
        .ref('messages')
        .orderByChild('timestamp')
        .startAt(sevenDaysAgo)
        .once('value');

      const rawMessages = messagesSnapshot.val() as Record<string, FirebaseMessageData> | null;
      const recentMessages: Record<string, FirebaseMessageData> = rawMessages || {};
      let messagesLast24h = 0;
      let messagesLast7d = 0;

      Object.values(recentMessages).forEach(message => {
        if (typeof message.timestamp === 'number' && message.timestamp >= oneDayAgo) {
          messagesLast24h++;
        }
        if (typeof message.timestamp === 'number' && message.timestamp >= sevenDaysAgo) {
          messagesLast7d++;
        }
      });

      return {
        totalMessages,
        messagesLast24h,
        messagesLast7d,
        totalStorageUsed: this.estimateStorageUsed(totalMessages),
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Failed to get backup stats',
        'ChatBackupService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return null;
    }
  }

  private validateMessageData(messageData: ChatMessage): boolean {
    return !!(
      messageData.id &&
      messageData.senderId &&
      messageData.receiverId &&
      messageData.content &&
      messageData.timestamp &&
      messageData.type &&
      ['text', 'image', 'file', 'audio', 'video'].includes(messageData.type)
    );
  }

  private createConversationId(userId1: string, userId2: string): string {
    // Create consistent conversation ID regardless of order
    return userId1 < userId2 ? `${userId1}_${userId2}` : `${userId2}_${userId1}`;
  }

  private generateMessageHash(messageData: ChatMessage): string {
    // Create a simple hash of the message content for integrity checking
    const content = `${messageData.senderId}:${messageData.receiverId}:${messageData.content}:${messageData.timestamp}`;
    return Buffer.from(content).toString('base64').substring(0, 16);
  }

  private async cleanupOldMessages(conversationId: string): Promise<void> {
    try {
      const cutoffTime = Date.now() - this.messageRetentionDays * 24 * 60 * 60 * 1000;

      const oldMessagesSnapshot = await this.database!.ref(`conversations/${conversationId}`)
        .orderByChild('timestamp')
        .endAt(cutoffTime)
        .limitToFirst(100)
        .once('value');

      const rawOldMessages = oldMessagesSnapshot.val() as Record<
        string,
        ConversationMessage
      > | null;
      const oldMessages: Record<string, unknown> | null = rawOldMessages;
      if (oldMessages) {
        const deleteUpdates: Record<string, unknown> = {};

        Object.keys(oldMessages).forEach(messageId => {
          deleteUpdates[`messages/${messageId}`] = null;
          deleteUpdates[`conversations/${conversationId}/${messageId}`] = null;
        });

        if (Object.keys(deleteUpdates).length > 0) {
          await this.database!.ref().update(deleteUpdates);
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            'Cleaned up old messages',
            'ChatBackupService',
            {
              conversationId,
              deletedCount: Object.keys(deleteUpdates).length / 2,
              cutoffTime,
            }
          );
        }
      }
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Failed to cleanup old messages',
        'ChatBackupService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          conversationId,
        }
      );
    }
  }

  private estimateStorageUsed(totalMessages: number): number {
    // Rough estimate: ~500 bytes per message on average
    return totalMessages * 500;
  }

  isHealthy(): boolean {
    return this.isInitialized;
  }
}
