/**
 * ZeptoMail File Cache Service
 * ============================
 * Handles file uploads to ZeptoMail File Cache for attachments
 * @see https://www.zoho.com/zeptomail/help/api-index.html
 *
 * @module ZeptoMailFileCacheService
 * @description ZeptoMail file cache service for attachment management
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { HttpService } from '@infrastructure/http';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';

export interface FileCacheUploadResult {
  success: boolean;
  fileKey?: string;
  error?: string;
}

@Injectable()
export class ZeptoMailFileCacheService {
  private readonly apiBaseUrl = 'https://api.zeptomail.com/v1.1';
  private sendMailToken: string = '';

  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => HttpService))
    private readonly httpService: HttpService
  ) {}

  /**
   * Initialize with Send Mail Token
   */
  initialize(sendMailToken: string): void {
    this.sendMailToken = sendMailToken;
  }

  /**
   * Upload file to ZeptoMail File Cache
   * @param fileContent - File content as Buffer or base64 string
   * @param filename - File name
   * @param contentType - MIME type (optional)
   * @returns File cache key for use in email attachments
   */
  async uploadFile(
    fileContent: Buffer | string,
    filename: string,
    contentType?: string
  ): Promise<FileCacheUploadResult> {
    if (!this.sendMailToken) {
      return {
        success: false,
        error: 'ZeptoMail File Cache service not initialized',
      };
    }

    try {
      // Convert to Buffer if string (base64)
      const fileBuffer = Buffer.isBuffer(fileContent)
        ? fileContent
        : Buffer.from(fileContent, 'base64');

      // Determine content type if not provided
      const mimeType = contentType || this.getMimeTypeFromFilename(filename);

      // Use multipart/form-data for file upload
      // ZeptoMail File Cache API expects multipart form data
      // Create multipart form data manually for axios
      // This is a simplified approach - for production, use form-data package
      const boundary = `----ZeptoMailFileCache${Date.now()}`;
      const formDataBuffer = Buffer.concat([
        Buffer.from(`--${boundary}\r\n`),
        Buffer.from(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`),
        Buffer.from(`Content-Type: ${mimeType}\r\n\r\n`),
        fileBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const response = await this.httpService.post<{ data?: { key?: string }; error?: unknown }>(
        `${this.apiBaseUrl}/filecache`,
        formDataBuffer,
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Zoho-enczapikey ${this.sendMailToken}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          timeout: 60000, // 60 seconds for file uploads
        }
      );

      if (response.data?.error) {
        const errorMessage =
          typeof response.data.error === 'object' && 'message' in response.data.error
            ? String(response.data.error.message)
            : 'Unknown error';
        return {
          success: false,
          error: errorMessage,
        };
      }

      const fileKey = response.data?.data?.key;

      if (!fileKey) {
        return {
          success: false,
          error: 'No file key returned from ZeptoMail',
        };
      }

      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.INFO,
        'File uploaded to ZeptoMail File Cache',
        'ZeptoMailFileCacheService',
        {
          filename,
          fileKey,
          contentType: mimeType,
        }
      );

      return {
        success: true,
        fileKey,
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        'Failed to upload file to ZeptoMail File Cache',
        'ZeptoMailFileCacheService',
        {
          error: error instanceof Error ? error.message : String(error),
          filename,
        }
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get MIME type from filename
   */
  private getMimeTypeFromFilename(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      txt: 'text/plain',
      csv: 'text/csv',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }
}
