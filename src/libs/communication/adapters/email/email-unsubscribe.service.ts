/**
 * Email Unsubscribe Service
 * ==========================
 * Handles email unsubscribe functionality
 * Manages unsubscribe tokens and updates user preferences
 *
 * @module EmailUnsubscribeService
 * @description Email unsubscribe service
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { DatabaseService } from '@infrastructure/database/database.service';
import { SuppressionListService } from './suppression-list.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import * as crypto from 'crypto';

@Injectable()
export class EmailUnsubscribeService {
  private readonly tokenSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly suppressionListService: SuppressionListService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    // Use JWT secret or generate a default secret for unsubscribe tokens
    this.tokenSecret =
      this.configService.getEnv('JWT_SECRET') ||
      this.configService.getEnv('UNSUBSCRIBE_TOKEN_SECRET') ||
      'default-unsubscribe-secret-change-in-production';
  }

  /**
   * Generate unsubscribe token
   */
  generateUnsubscribeToken(email: string, userId?: string): string {
    const payload = {
      email: email.toLowerCase(),
      userId: userId || null,
      timestamp: Date.now(),
    };

    const payloadString = JSON.stringify(payload);
    const hmac = crypto.createHmac('sha256', this.tokenSecret);
    hmac.update(payloadString);
    const signature = hmac.digest('hex');

    // Encode token as base64
    const token = Buffer.from(`${payloadString}:${signature}`).toString('base64url');
    return token;
  }

  /**
   * Verify and decode unsubscribe token
   */
  private verifyUnsubscribeToken(token: string): { email: string; userId?: string } | null {
    try {
      // Decode token
      const decoded = Buffer.from(token, 'base64url').toString('utf-8');
      const [payloadString, signature] = decoded.split(':');

      if (!payloadString || !signature) {
        return null;
      }

      // Verify signature
      const hmac = crypto.createHmac('sha256', this.tokenSecret);
      hmac.update(payloadString);
      const expectedSignature = hmac.digest('hex');

      if (signature !== expectedSignature) {
        return null;
      }

      // Parse payload
      const payload = JSON.parse(payloadString) as {
        email: string;
        userId?: string;
        timestamp: number;
      };

      // Check token expiration (30 days)
      const tokenAge = Date.now() - payload.timestamp;
      const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days

      if (tokenAge > maxAge) {
        return null;
      }

      return {
        email: payload.email.toLowerCase(),
        ...(payload.userId && { userId: payload.userId }),
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.EMAIL,
        LogLevel.WARN,
        `Failed to verify unsubscribe token: ${error instanceof Error ? error.message : String(error)}`,
        'EmailUnsubscribeService',
        { error: error instanceof Error ? error.stack : undefined }
      );
      return null;
    }
  }

  /**
   * Unsubscribe user from emails
   */
  async unsubscribe(
    token: string,
    email?: string
  ): Promise<{ success: boolean; message: string; email?: string }> {
    try {
      // Verify token
      const tokenData = this.verifyUnsubscribeToken(token);

      if (!tokenData) {
        // If token is invalid, try with provided email
        if (email) {
          return await this.unsubscribeByEmail(email);
        }

        return {
          success: false,
          message: 'Invalid or expired unsubscribe token',
        };
      }

      const { email: tokenEmail, userId } = tokenData;

      // Use email from token or provided email
      const unsubscribeEmail = email ? email.toLowerCase() : tokenEmail;

      // Add to suppression list
      await this.suppressionListService.handleUnsubscribe(unsubscribeEmail, userId, {
        token: token.substring(0, 10) + '...', // Log partial token for security
        timestamp: new Date().toISOString(),
      });

      // Update user preferences if user found
      if (userId) {
        await this.updateUserEmailPreference(userId, false);
      } else {
        // Try to find user by email
        const user = await this.findUserByEmail(unsubscribeEmail);
        if (user) {
          await this.updateUserEmailPreference(user.id, false);
        }
      }

      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.INFO,
        `User unsubscribed from emails: ${unsubscribeEmail}`,
        'EmailUnsubscribeService',
        {
          email: unsubscribeEmail,
          userId,
        }
      );

      return {
        success: true,
        message: 'You have been successfully unsubscribed from our emails.',
        email: unsubscribeEmail,
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        `Failed to unsubscribe: ${error instanceof Error ? error.message : String(error)}`,
        'EmailUnsubscribeService',
        {
          error: error instanceof Error ? error.stack : undefined,
          token: token.substring(0, 10) + '...',
          email,
        }
      );

      return {
        success: false,
        message: 'Failed to process unsubscribe request. Please contact support.',
      };
    }
  }

  /**
   * Unsubscribe by email (fallback)
   */
  private async unsubscribeByEmail(email: string): Promise<{
    success: boolean;
    message: string;
    email?: string;
  }> {
    const normalizedEmail = email.toLowerCase();

    // Add to suppression list
    await this.suppressionListService.handleUnsubscribe(normalizedEmail, undefined, {
      method: 'direct_email',
      timestamp: new Date().toISOString(),
    });

    // Try to find and update user
    const user = await this.findUserByEmail(normalizedEmail);
    if (user) {
      await this.updateUserEmailPreference(user.id, false);
    }

    return {
      success: true,
      message: 'You have been successfully unsubscribed from our emails.',
      email: normalizedEmail,
    };
  }

  /**
   * Find user by email
   */
  private async findUserByEmail(email: string): Promise<{ id: string } | null> {
    try {
      const user = await this.databaseService.executeHealthcareRead(async client => {
        const userClient = client as unknown as {
          user: {
            findUnique: (args: {
              where: { email: string };
              select: { id: true };
            }) => Promise<{ id: string } | null>;
          };
        };
        return await userClient.user.findUnique({
          where: { email: email.toLowerCase() },
          select: { id: true },
        });
      });
      return user;
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.WARN,
        `Failed to find user by email: ${error instanceof Error ? error.message : String(error)}`,
        'EmailUnsubscribeService',
        { email }
      );
      return null;
    }
  }

  /**
   * Update user email preference
   */
  private async updateUserEmailPreference(userId: string, enabled: boolean): Promise<void> {
    try {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const notificationPreferenceClient = client as unknown as {
            notificationPreference: {
              upsert: (args: {
                where: { userId: string };
                update: { emailEnabled: boolean };
                create: {
                  userId: string;
                  emailEnabled: boolean;
                  smsEnabled: boolean;
                  pushEnabled: boolean;
                  socketEnabled: boolean;
                  whatsappEnabled: boolean;
                  appointmentEnabled: boolean;
                  ehrEnabled: boolean;
                  billingEnabled: boolean;
                  systemEnabled: boolean;
                };
              }) => Promise<unknown>;
            };
          };
          await notificationPreferenceClient.notificationPreference.upsert({
            where: { userId },
            update: { emailEnabled: enabled },
            create: {
              userId,
              emailEnabled: enabled,
              smsEnabled: true,
              pushEnabled: true,
              socketEnabled: true,
              whatsappEnabled: false,
              appointmentEnabled: true,
              ehrEnabled: true,
              billingEnabled: true,
              systemEnabled: true,
            },
          });
        },
        {
          userId,
          userRole: 'SYSTEM',
          clinicId: '',
          operation: 'UPDATE_EMAIL_PREFERENCE',
          resourceType: 'NOTIFICATION_PREFERENCE',
          resourceId: userId,
          timestamp: new Date(),
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.WARN,
        `Failed to update user email preference: ${error instanceof Error ? error.message : String(error)}`,
        'EmailUnsubscribeService',
        { userId, enabled }
      );
    }
  }

  /**
   * Generate unsubscribe URL
   */
  generateUnsubscribeUrl(email: string, userId?: string): string {
    const token = this.generateUnsubscribeToken(email, userId);
    // SECURITY: Use ConfigService instead of hardcoded localhost URL
    const baseUrl =
      this.configService.getEnv('BASE_URL') ||
      this.configService.getEnv('API_URL') ||
      (() => {
        throw new Error(
          'Missing required environment variable: BASE_URL or API_URL. Please set BASE_URL or API_URL in environment configuration.'
        );
      })();
    return `${baseUrl}/api/v1/email/unsubscribe?token=${token}`;
  }
}
