import { Module } from '@nestjs/common';
import { ConfigModule } from '@config';
import { SecurityConfigService } from './security-config.service';

/**
 * Security Module
 *
 * Provides security configuration services including:
 * - Rate limiting
 * - CORS
 * - Helmet security headers
 * - Bot detection
 * - Compression
 * - Multipart handling
 *
 * @module SecurityModule
 * @description Enterprise-grade security module for healthcare applications
 */
@Module({
  imports: [ConfigModule],
  providers: [SecurityConfigService],
  exports: [SecurityConfigService],
})
export class SecurityModule {}
