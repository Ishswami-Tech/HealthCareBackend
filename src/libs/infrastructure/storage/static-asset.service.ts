/**
 * Static Asset Service
 * ====================
 * Unified service for managing static assets (QR codes, PDFs, images)
 * Uses S3StorageService with automatic fallback to local storage
 *
 * @module StaticAssetService
 * @description Unified static asset management service
 */

import { Injectable } from '@nestjs/common';
import {
  PRIVATE_ASSET_URL_TTL_SECONDS,
  S3StorageService,
  UploadResult,
} from './s3-storage.service';
import { LoggingService } from '@logging';
import { LogType, LogLevel } from '@core/types';

/**
 * Asset Type
 */
export enum AssetType {
  QR_CODE = 'qr-codes',
  INVOICE_PDF = 'invoices',
  PRESCRIPTION_PDF = 'prescriptions',
  MEDICAL_RECORD = 'medical-records',
  IMAGE = 'images',
  DOCUMENT = 'documents',
  LIBRARY_COVER = 'library-covers',
}

/**
 * Folders holding patient-uploaded / clinical files. Objects here are stored
 * PRIVATE and handed to clients as presigned URLs (see `resolveSignedUrl`).
 */
const SIGNED_URL_FOLDERS: readonly string[] = [AssetType.DOCUMENT, AssetType.MEDICAL_RECORD];

/**
 * Static Asset Service
 * Provides unified interface for static asset management
 */
@Injectable()
export class StaticAssetService {
  constructor(
    private readonly s3StorageService: S3StorageService,
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Upload QR code image
   */
  async uploadQRCode(qrCodeBuffer: Buffer, locationId: string): Promise<UploadResult> {
    const fileName = `qr-${locationId}-${Date.now()}.png`;
    return this.uploadFile(qrCodeBuffer, fileName, AssetType.QR_CODE, 'image/png', true);
  }

  /**
   * Upload invoice PDF
   */
  async uploadInvoicePDF(pdfBuffer: Buffer, invoiceId: string): Promise<UploadResult> {
    const fileName = `invoice-${invoiceId}-${Date.now()}.pdf`;
    return this.uploadFile(pdfBuffer, fileName, AssetType.INVOICE_PDF, 'application/pdf', false);
  }

  /**
   * Upload prescription PDF
   */
  async uploadPrescriptionPDF(pdfBuffer: Buffer, prescriptionId: string): Promise<UploadResult> {
    const fileName = `prescription-${prescriptionId}-${Date.now()}.pdf`;
    return this.uploadFile(
      pdfBuffer,
      fileName,
      AssetType.PRESCRIPTION_PDF,
      'application/pdf',
      false
    );
  }

  /**
   * Upload medical record
   */
  async uploadMedicalRecord(
    fileBuffer: Buffer,
    recordId: string,
    contentType: string
  ): Promise<UploadResult> {
    const extension = this.getExtensionFromContentType(contentType);
    const fileName = `medical-record-${recordId}-${Date.now()}.${extension}`;
    return this.uploadFile(fileBuffer, fileName, AssetType.MEDICAL_RECORD, contentType, false);
  }

  /**
   * Upload generic file
   */
  async uploadFile(
    fileBuffer: Buffer,
    fileName: string,
    assetType: AssetType,
    contentType: string,
    isPublic = false
  ): Promise<UploadResult> {
    const startTime = Date.now();
    try {
      const result = await this.s3StorageService.uploadFile(
        fileBuffer,
        fileName,
        assetType,
        contentType,
        isPublic
      );

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Static asset uploaded: ${assetType}/${fileName}`,
        'StaticAssetService',
        {
          assetType,
          fileName,
          storageType: this.s3StorageService.getStorageType(),
          success: result.success,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to upload static asset: ${error instanceof Error ? error.message : String(error)}`,
        'StaticAssetService',
        {
          assetType,
          fileName,
          error: error instanceof Error ? error.stack : undefined,
        }
      );

      throw error;
    }
  }

  /**
   * Delete asset
   */
  async deleteAsset(key: string): Promise<boolean> {
    try {
      const result = await this.s3StorageService.deleteFile(key);
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Static asset deleted: ${key}`,
        'StaticAssetService',
        {
          key,
          success: result,
        }
      );
      return result;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to delete static asset: ${error instanceof Error ? error.message : String(error)}`,
        'StaticAssetService',
        {
          key,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return false;
    }
  }

  /**
   * Get public URL for asset (with presigned URL for private assets)
   */
  async getPublicUrl(key: string, expiresIn = 3600): Promise<string> {
    if (this.s3StorageService.isS3Enabled()) {
      // If key is a presigned URL placeholder, generate actual presigned URL
      if (key.startsWith('s3://')) {
        const actualKey = key.replace('s3://', '').split('/').slice(1).join('/');
        return await this.s3StorageService.getPublicUrl(actualKey, expiresIn);
      }
      // If already a full URL, return as-is
      if (key.startsWith('http://') || key.startsWith('https://')) {
        return key;
      }
      // Generate presigned URL
      return await this.s3StorageService.getPublicUrl(key, expiresIn);
    }

    // Local storage - return relative path
    return key;
  }

  /**
   * Presigned GET URL (default 15 minutes) for an object key of the configured
   * bucket. Throws when S3 is not enabled. The URL is a bearer credential: it is
   * never logged.
   */
  async getSignedDownloadUrl(
    key: string,
    ttlSeconds: number = PRIVATE_ASSET_URL_TTL_SECONDS
  ): Promise<string> {
    return await this.s3StorageService.getSignedDownloadUrl(key, ttlSeconds);
  }

  /**
   * URL a client can use to open a stored document / medical-record file.
   *
   * - own-bucket object under `documents/` or `medical-records/` -> short-lived
   *   presigned GET URL (also fine for legacy public-read objects)
   * - local-disk fallback (`/storage/...`), S3 disabled, foreign host, other
   *   folder, traversal attempt -> the stored value, unchanged
   * - presigning failure -> the stored value plus a warning (the URL is never
   *   logged); a listing must not fail because one object could not be signed
   *
   * `options.boundTo` ties the signature to the ROW the URL was read from: the object
   * key must contain at least one of these ids (record id / patient id / user id; the
   * writers put them into the object name), otherwise the stored value is returned
   * unsigned. So a stored URL that points at somebody else's object can never be turned
   * into a valid presigned link. An empty list never matches (fail closed).
   *
   * Never throws.
   */
  async resolveSignedUrl(
    storedUrl: string,
    ttlSeconds: number = PRIVATE_ASSET_URL_TTL_SECONDS,
    options: { readonly boundTo?: ReadonlyArray<string | null | undefined> } = {}
  ): Promise<string> {
    if (!storedUrl || !this.s3StorageService.isS3Enabled()) {
      return storedUrl;
    }
    const key = this.s3StorageService.resolveOwnedObjectKey(storedUrl, SIGNED_URL_FOLDERS);
    if (!key) {
      return storedUrl;
    }
    if (options.boundTo !== undefined) {
      const markers = options.boundTo.filter(
        (marker): marker is string => typeof marker === 'string' && marker.length > 0
      );
      if (!markers.some(marker => key.includes(marker))) {
        await this.loggingService
          .log(
            LogType.SYSTEM,
            LogLevel.WARN,
            'A stored private asset URL does not belong to its row; it was not presigned',
            'StaticAssetService',
            { folder: key.split('/')[0] }
          )
          .catch(() => undefined);
        return storedUrl;
      }
    }

    try {
      return await this.getSignedDownloadUrl(key, ttlSeconds);
    } catch (error) {
      await this.loggingService
        .log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Could not presign a private asset URL; returning the stored URL',
          'StaticAssetService',
          {
            folder: key.split('/')[0],
            error: error instanceof Error ? error.message : String(error),
          }
        )
        .catch(() => undefined);
      return storedUrl;
    }
  }

  /**
   * Get extension from content type
   */
  private getExtensionFromContentType(contentType: string): string {
    const mapping: Record<string, string> = {
      'application/pdf': 'pdf',
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/gif': 'gif',
      'image/svg+xml': 'svg',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    };

    return mapping[contentType] || 'bin';
  }

  /**
   * Check if S3 is enabled
   */
  isS3Enabled(): boolean {
    return this.s3StorageService.isS3Enabled();
  }

  /**
   * Get storage type
   */
  getStorageType(): 's3' | 'local' {
    return this.s3StorageService.getStorageType();
  }

  /**
   * Get storage provider name
   */
  getStorageProvider(): string {
    return this.s3StorageService.getStorageProvider();
  }
}
