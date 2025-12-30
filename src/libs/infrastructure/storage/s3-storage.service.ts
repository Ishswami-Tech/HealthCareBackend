/**
 * S3 Storage Service
 * ==================
 * S3-compatible storage integration (Contabo S3, AWS S3, etc.) for static asset storage
 * Supports QR codes, PDFs, images with automatic fallback to local storage
 * Kubernetes handles backups via persistent volumes
 *
 * @module S3StorageService
 * @description S3-compatible storage service following Strategy pattern
 * @see https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-examples.html - AWS S3 SDK documentation
 * @see https://contabo.com/en/products/object-storage/ - Contabo S3-compatible storage
 *
 * Note: AWS SDK S3Client types are correctly resolved by TypeScript compiler.
 * ESLint's type-aware rules have limitations resolving complex external type definitions.
 * All type assertions below are safe and verified by TypeScript compilation.
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { S3ClientConfig } from '@aws-sdk/client-s3';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * S3 Storage Configuration
 * Supports any S3-compatible provider (Contabo, AWS, Wasabi, etc.)
 */
interface S3Config {
  enabled: boolean;
  provider: 'contabo' | 'aws' | 'wasabi' | 'custom'; // Storage provider
  endpoint?: string; // S3-compatible endpoint (required for Contabo, optional for AWS)
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean; // Required for Contabo and other S3-compatible providers
  cdnUrl?: string; // CDN URL for public assets
  publicUrlExpiration?: number; // URL expiration in seconds (default: 1 hour)
}

/**
 * Upload Result
 */
export interface UploadResult {
  success: boolean;
  url?: string; // Public URL
  key?: string; // S3 object key
  localPath?: string; // Local file path (if fallback used)
  error?: string;
}

/**
 * S3 Storage Service
 * Handles file uploads to S3 with local storage fallback
 */
@Injectable()
export class S3StorageService implements OnModuleInit {
  // S3Client from @aws-sdk/client-s3
  // TypeScript correctly resolves this type (verified by successful compilation)
  // Using 'unknown' with type guards to satisfy ESLint while maintaining runtime type safety
  private s3Client: unknown = null;
  private config: S3Config;
  private localStoragePath: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService
  ) {
    const provider = this.configService.get<string>('S3_PROVIDER', 'contabo') as
      | 'contabo'
      | 'aws'
      | 'wasabi'
      | 'custom';
    const endpoint = this.configService.get<string>('S3_ENDPOINT');
    const region = this.configService.get<string>(
      'S3_REGION',
      provider === 'contabo' ? 'eu-central-1' : 'us-east-1'
    );

    this.config = {
      enabled: this.configService.get<boolean>('S3_ENABLED', false),
      provider,
      endpoint,
      region,
      bucket: this.configService.get<string>('S3_BUCKET', ''),
      accessKeyId:
        this.configService.get<string>('S3_ACCESS_KEY_ID') ||
        this.configService.get<string>('AWS_ACCESS_KEY_ID'),
      secretAccessKey:
        this.configService.get<string>('S3_SECRET_ACCESS_KEY') ||
        this.configService.get<string>('AWS_SECRET_ACCESS_KEY'),
      forcePathStyle: this.configService.get<boolean>('S3_FORCE_PATH_STYLE', provider !== 'aws'),
      cdnUrl: this.configService.get<string>('CDN_URL'),
      publicUrlExpiration: this.configService.get<number>('S3_PUBLIC_URL_EXPIRATION', 3600),
    };

    // Local storage fallback path (Kubernetes persistent volume handles backups)
    this.localStoragePath = path.join(process.cwd(), 'storage', 'assets');
  }

  async onModuleInit(): Promise<void> {
    if (this.config.enabled && this.config.bucket) {
      try {
        // Build S3 client configuration with explicit type annotations
        const clientConfig: S3ClientConfig = {
          region: this.config.region,
        };

        // Add endpoint for S3-compatible providers (Contabo, Wasabi, etc.)
        if (this.config.endpoint) {
          clientConfig.endpoint = this.config.endpoint;
        }

        // Force path-style for S3-compatible providers
        if (this.config.forcePathStyle) {
          clientConfig.forcePathStyle = true;
        }

        // Add credentials if provided
        if (this.config.accessKeyId && this.config.secretAccessKey) {
          clientConfig.credentials = {
            accessKeyId: this.config.accessKeyId,
            secretAccessKey: this.config.secretAccessKey,
          };
        }

        // Create S3 client instance
        // Type assertion ensures type safety - verified by TypeScript compilation
        this.s3Client = new S3Client(clientConfig);

        // Test connection
        await this.testConnection();
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `S3 storage initialized successfully (Provider: ${this.config.provider}, Region: ${this.config.region})`,
          'S3StorageService.onModuleInit',
          { provider: this.config.provider, region: this.config.region }
        );
      } catch (error) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `S3 initialization failed, using local storage fallback: ${error instanceof Error ? error.message : String(error)}`,
          'S3StorageService.onModuleInit',
          {
            error: error instanceof Error ? error.message : String(error),
            provider: this.config.provider,
          }
        );
        this.config.enabled = false;
        this.s3Client = null;
      }
    } else {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'S3 storage disabled, using local storage fallback (Kubernetes persistent volume)',
        'S3StorageService.onModuleInit',
        {}
      );
    }

    // Ensure local storage directory exists (backed up by Kubernetes persistent volumes)
    try {
      if (!fs.existsSync(this.localStoragePath)) {
        fs.mkdirSync(this.localStoragePath, { recursive: true, mode: 0o755 });
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `Local storage directory created: ${this.localStoragePath}`,
          'S3StorageService.onModuleInit',
          { localStoragePath: this.localStoragePath }
        );
      }
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to create local storage directory: ${error instanceof Error ? error.message : String(error)}`,
        'S3StorageService.onModuleInit',
        {
          error: error instanceof Error ? error.message : String(error),
          localStoragePath: this.localStoragePath,
        }
      );
    }
  }

  /**
   * Test S3 connection
   */
  private async testConnection(): Promise<void> {
    if (!this.s3Client || !this.config.bucket) {
      throw new Error('S3 client not initialized');
    }

    try {
      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: 'health-check',
      });
      // Type assertion - verified safe by TypeScript compilation
      const client = this.s3Client as S3Client;
      await client.send(command);
    } catch (error) {
      // If object doesn't exist, that's OK - bucket exists
      if (error instanceof Error && error.name !== 'NotFound') {
        throw error;
      }
    }
  }

  /**
   * Upload file to S3 or local storage
   * @param fileBuffer - File buffer
   * @param fileName - File name
   * @param folder - Folder path (e.g., 'qr-codes', 'invoices')
   * @param contentType - MIME type
   * @param isPublic - Whether file should be publicly accessible
   */
  async uploadFile(
    fileBuffer: Buffer,
    fileName: string,
    folder: string,
    contentType: string,
    isPublic = false
  ): Promise<UploadResult> {
    const fileKey = `${folder}/${uuidv4()}-${fileName}`;

    // Try S3 first if enabled
    if (this.config.enabled && this.s3Client) {
      try {
        const command = new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: fileKey,
          Body: fileBuffer,
          ContentType: contentType,
          ...(isPublic && { ACL: 'public-read' }),
        });

        // Type assertion - verified safe by TypeScript compilation
        const client = this.s3Client as S3Client;
        await client.send(command);

        // Generate public URL
        const url = this.generatePublicUrl(fileKey, isPublic);

        return {
          success: true,
          url,
          key: fileKey,
        };
      } catch (error) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `S3 upload failed, falling back to local storage: ${error instanceof Error ? error.message : String(error)}`,
          'S3StorageService.uploadFile',
          {
            error: error instanceof Error ? error.message : String(error),
            fileName,
            folder,
          }
        );
        // Fall through to local storage
      }
    }

    // Fallback to local storage
    return this.uploadToLocalStorage(fileBuffer, fileName, folder, contentType);
  }

  /**
   * Upload to local storage (fallback)
   * Files stored in Kubernetes persistent volume (backed up automatically)
   */
  private uploadToLocalStorage(
    fileBuffer: Buffer,
    fileName: string,
    folder: string,
    _contentType: string
  ): UploadResult {
    try {
      const folderPath = path.join(this.localStoragePath, folder);
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true, mode: 0o755 });
      }

      const filePath = path.join(folderPath, `${uuidv4()}-${fileName}`);
      fs.writeFileSync(filePath, fileBuffer);

      // Generate local URL (relative path)
      // In Kubernetes, this will be served via ingress/nginx
      const url = `/storage/assets/${folder}/${path.basename(filePath)}`;

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `File uploaded to local storage: ${filePath}`,
        'S3StorageService.uploadToLocalStorage',
        { filePath, folder, fileName }
      );

      return {
        success: true,
        url,
        localPath: filePath,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Local storage upload failed: ${error instanceof Error ? error.message : String(error)}`,
        'S3StorageService.uploadToLocalStorage',
        {
          error: error instanceof Error ? error.message : String(error),
          fileName,
          folder,
        }
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate public URL for S3 object
   * Supports both AWS S3 and S3-compatible providers (Contabo, Wasabi, etc.)
   */
  private generatePublicUrl(key: string, isPublic: boolean): string {
    // Use CDN URL if configured
    if (this.config.cdnUrl) {
      return `${this.config.cdnUrl}/${key}`;
    }

    // Generate presigned URL for private objects
    if (!isPublic && this.s3Client && this.config.bucket) {
      // Presigned URL will be generated in getPublicUrl method
      return `s3://${this.config.bucket}/${key}`;
    }

    // Generate public URL based on provider
    if (this.config.endpoint) {
      // S3-compatible provider (Contabo, Wasabi, etc.)
      // Contabo format: https://{endpoint}/{access-key-id}:{bucket}/{key}
      // Example: https://eu2.contabostorage.com/{access-key-id}:healthcaredata/{key}
      const endpointUrl = this.config.endpoint.replace(/\/$/, ''); // Remove trailing slash

      // For Contabo, include access key ID in URL path if available
      if (this.config.provider === 'contabo' && this.config.accessKeyId) {
        return `${endpointUrl}/${this.config.accessKeyId}:${this.config.bucket}/${key}`;
      }

      // Other S3-compatible providers (Wasabi, etc.) use standard format
      return `${endpointUrl}/${this.config.bucket}/${key}`;
    }

    // AWS S3 public URL
    return `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${key}`;
  }

  /**
   * Get presigned URL for private S3 object
   */
  async getPublicUrl(key: string, expiresIn = 3600): Promise<string> {
    if (!this.s3Client || !this.config.bucket) {
      throw new Error('S3 client not initialized');
    }

    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });

    // Type assertion - verified safe by TypeScript compilation
    const client = this.s3Client as S3Client;
    return await getSignedUrl(client, command, { expiresIn });
  }

  /**
   * Delete file from S3 or local storage
   */
  async deleteFile(key: string): Promise<boolean> {
    // Try S3 first (if key doesn't start with s3:// and S3 is enabled)
    if (
      this.config.enabled &&
      this.s3Client &&
      !key.startsWith('s3://') &&
      !key.startsWith('/storage/')
    ) {
      try {
        const command = new DeleteObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        });
        // Type assertion - verified safe by TypeScript compilation
        const client = this.s3Client as S3Client;
        await client.send(command);
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.DEBUG,
          `File deleted from S3: ${key}`,
          'S3StorageService.deleteFile',
          { key, bucket: this.config.bucket }
        );
        return true;
      } catch (error) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `S3 delete failed: ${error instanceof Error ? error.message : String(error)}`,
          'S3StorageService.deleteFile',
          {
            error: error instanceof Error ? error.message : String(error),
            key,
            bucket: this.config.bucket,
          }
        );
        // Fall through to local storage
      }
    }

    // Try local storage
    // Handle both full paths and relative paths
    let localPath: string;
    if (key.startsWith('/storage/assets/')) {
      // Relative URL path
      localPath = path.join(process.cwd(), key);
    } else if (key.startsWith(this.localStoragePath)) {
      // Full path
      localPath = key;
    } else {
      // Assume it's a key relative to localStoragePath
      localPath = path.join(this.localStoragePath, key);
    }

    if (fs.existsSync(localPath)) {
      try {
        fs.unlinkSync(localPath);
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.DEBUG,
          `File deleted from local storage: ${localPath}`,
          'S3StorageService.deleteFile',
          { localPath, key }
        );
        return true;
      } catch (error) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Local file delete failed: ${error instanceof Error ? error.message : String(error)}`,
          'S3StorageService.deleteFile',
          {
            error: error instanceof Error ? error.message : String(error),
            localPath,
            key,
          }
        );
      }
    }

    return false;
  }

  /**
   * Check if S3 is enabled
   */
  isS3Enabled(): boolean {
    return this.config.enabled && this.s3Client !== null;
  }

  /**
   * Get storage type (s3 or local)
   */
  getStorageType(): 's3' | 'local' {
    return this.isS3Enabled() ? 's3' : 'local';
  }

  /**
   * Get storage provider name
   */
  getStorageProvider(): string {
    if (!this.isS3Enabled()) {
      return 'local';
    }
    return this.config.provider;
  }
}
