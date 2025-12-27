/**
 * ZeptoMail Suppression List Sync Service
 * =======================================
 * Syncs suppression list with ZeptoMail's suppression list API
 * @see https://www.zoho.com/zeptomail/help/suppression-lists.html
 *
 * @module ZeptoMailSuppressionSyncService
 * @description ZeptoMail suppression list synchronization service
 */

import { Injectable, Inject, forwardRef, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { HttpService } from '@infrastructure/http';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import {
  SuppressionListService,
  SuppressionReason,
  SuppressionSource,
} from '@communication/adapters/email/suppression-list.service';

@Injectable()
export class ZeptoMailSuppressionSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly apiBaseUrl = 'https://api.zeptomail.com/v1.1';
  private sendMailToken: string = '';
  private syncInterval?: NodeJS.Timeout;

  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => HttpService))
    private readonly httpService: HttpService,
    @Inject(forwardRef(() => SuppressionListService))
    private readonly suppressionListService: SuppressionListService
  ) {}

  onModuleInit(): void {
    // Sync suppression list every 6 hours
    this.syncInterval = setInterval(
      () => {
        void this.syncSuppressionList();
      },
      6 * 60 * 60 * 1000
    );
  }

  onModuleDestroy(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
  }

  /**
   * Initialize with Send Mail Token
   */
  initialize(sendMailToken: string): void {
    this.sendMailToken = sendMailToken;
  }

  /**
   * Sync suppression list from ZeptoMail
   */
  async syncSuppressionList(): Promise<void> {
    if (!this.sendMailToken) {
      return;
    }

    try {
      // Fetch suppression list from ZeptoMail
      const response = await this.httpService.get<{
        data?: Array<{
          email_address?: string;
          reason?: string;
          timestamp?: string;
        }>;
        error?: { code?: string; message?: string };
      }>(`${this.apiBaseUrl}/suppressionlist`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Zoho-enczapikey ${this.sendMailToken}`,
        },
        timeout: 30000,
      });

      if (response.data?.error) {
        await this.loggingService.log(
          LogType.EMAIL,
          LogLevel.ERROR,
          'Failed to fetch ZeptoMail suppression list',
          'ZeptoMailSuppressionSyncService',
          {
            error: response.data.error.message,
            errorCode: response.data.error.code,
          }
        );
        return;
      }

      const suppressionList = response.data?.data || [];

      // Sync each suppressed email to our database
      for (const entry of suppressionList) {
        if (entry.email_address) {
          const email = entry.email_address.toLowerCase();
          const reason = entry.reason || 'BOUNCE';

          // Add to our suppression list if not already present
          await this.suppressionListService.addToSuppressionList(
            email,
            reason === 'COMPLAINT' ? SuppressionReason.COMPLAINT : SuppressionReason.BOUNCE,
            SuppressionSource.ZEPTOMAIL,
            {
              metadata: {
                syncedFromZeptoMail: true,
                syncedAt: new Date().toISOString(),
              },
            }
          );
        }
      }

      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.INFO,
        'ZeptoMail suppression list synced',
        'ZeptoMailSuppressionSyncService',
        {
          count: suppressionList.length,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        'Failed to sync ZeptoMail suppression list',
        'ZeptoMailSuppressionSyncService',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Add email to ZeptoMail suppression list
   */
  async addToZeptoMailSuppressionList(
    email: string,
    reason: 'bounce' | 'complaint' | 'unsubscribe'
  ): Promise<boolean> {
    if (!this.sendMailToken) {
      return false;
    }

    try {
      const response = await this.httpService.post<{
        data?: unknown;
        error?: { code?: string; message?: string };
      }>(
        `${this.apiBaseUrl}/suppressionlist`,
        {
          email_address: email.toLowerCase(),
          reason,
        },
        {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Zoho-enczapikey ${this.sendMailToken}`,
          },
          timeout: 30000,
        }
      );

      if (response.data?.error) {
        await this.loggingService.log(
          LogType.EMAIL,
          LogLevel.ERROR,
          'Failed to add email to ZeptoMail suppression list',
          'ZeptoMailSuppressionSyncService',
          {
            error: response.data.error.message,
            email,
            reason,
          }
        );
        return false;
      }

      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.INFO,
        'Email added to ZeptoMail suppression list',
        'ZeptoMailSuppressionSyncService',
        {
          email,
          reason,
        }
      );

      return true;
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        'Failed to add email to ZeptoMail suppression list',
        'ZeptoMailSuppressionSyncService',
        {
          error: error instanceof Error ? error.message : String(error),
          email,
          reason,
        }
      );
      return false;
    }
  }
}
