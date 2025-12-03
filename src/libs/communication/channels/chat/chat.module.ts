import { Module } from '@nestjs/common';
import { ConfigModule } from '@config';
import { LoggingModule } from '@logging';
import { ChatBackupService } from './chat-backup.service';

/**
 * Chat Module
 *
 * Provides chat message backup and synchronization services.
 * Uses Firebase Realtime Database for chat message storage.
 *
 * Features:
 * - Chat message backup to Firebase
 * - Message history retrieval
 * - Conversation synchronization
 * - HIPAA-compliant logging
 *
 * @module ChatModule
 */
@Module({
  imports: [ConfigModule, LoggingModule],
  providers: [ChatBackupService],
  exports: [ChatBackupService],
})
export class ChatModule {}
