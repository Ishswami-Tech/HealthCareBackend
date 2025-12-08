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
import { S3StorageService, UploadResult } from './s3-storage.service';
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
}

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
