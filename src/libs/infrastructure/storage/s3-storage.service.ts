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
 * CDN Configuration:
 * - For Contabo provider: CDN URL is automatically generated from S3_ENDPOINT, S3_ACCESS_KEY_ID, and S3_BUCKET
 * - Format: https://{endpoint}/{access-key-id}:{bucket}
 * - Set CDN_URL environment variable only if using a different CDN provider (e.g., Cloudflare, AWS CloudFront)
 *
 * Note: AWS SDK S3Client types are correctly resolved by TypeScript compiler.
 * ESLint's type-aware rules have limitations resolving complex external type definitions.
 * All type assertions below are safe and verified by TypeScript compilation.
 */

import { Inject, Injectable, OnModuleInit, forwardRef } from '@nestjs/common';
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

// ---------------------------------------------------------------------------
// Presigned-URL helpers for PRIVATE objects (pure, no AWS SDK).
//
// Kept in this file on purpose: `.gitignore` ignores new files in any `storage/`
// directory. The decision "is this one of OUR objects?" matters: a stored `fileUrl` is
// only ever presigned when it demonstrably points into OUR bucket and a folder we
// manage, so a tampered / client-supplied URL can never make the API sign an
// arbitrary object.
// ---------------------------------------------------------------------------

/** Lifetime of a presigned GET URL handed to clients (15 minutes). */
export const PRIVATE_ASSET_URL_TTL_SECONDS = 15 * 60;

/** SigV4 presigned URLs cannot live longer than 7 days. */
const MAX_PRESIGN_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface OwnedUrlConfig {
  readonly bucket: string;
  readonly region: string;
  readonly endpoint?: string | undefined;
  readonly cdnUrl?: string | undefined;
  readonly accessKeyId?: string | undefined;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Clamp a requested lifetime into the range S3 accepts (1 second .. 7 days). */
export function clampPresignTtl(ttlSeconds: number): number {
  if (!Number.isFinite(ttlSeconds)) {
    return PRIVATE_ASSET_URL_TTL_SECONDS;
  }
  return Math.min(Math.max(1, Math.floor(ttlSeconds)), MAX_PRESIGN_TTL_SECONDS);
}

/**
 * Every URL prefix (scheme + host + base path, trailing slash) under which an
 * object of the configured bucket can have been published by
 * `S3StorageService.generatePublicUrl`: the `s3://bucket/` placeholder, the CDN
 * base, the S3-compatible endpoint (Contabo `<endpoint>/<accessKeyId>:<bucket>/`
 * and plain path-style) and the AWS virtual-hosted style.
 */
export function buildOwnedUrlPrefixes(config: OwnedUrlConfig): readonly string[] {
  if (!config.bucket) {
    return [];
  }
  const prefixes = [`s3://${config.bucket}/`];

  if (config.cdnUrl) {
    prefixes.push(`${trimTrailingSlashes(config.cdnUrl)}/`);
  }
  if (config.endpoint) {
    const base = trimTrailingSlashes(config.endpoint);
    if (config.accessKeyId) {
      prefixes.push(`${base}/${config.accessKeyId}:${config.bucket}/`);
    }
    prefixes.push(`${base}/${config.bucket}/`);
  }
  prefixes.push(`https://${config.bucket}.s3.${config.region}.amazonaws.com/`);
  return Array.from(new Set(prefixes));
}

/**
 * Top-level folders (= `AssetType` values) that hold patient health information:
 * patient documents, EHR medical-record files, invoices and prescription PDFs.
 *
 * When S3 is configured these are NEVER written to the pod-local disk as a fallback:
 * the local copy is not private (the `/storage/` URL is served by the ingress), is not
 * presigned, and is lost with the pod. A failed upload is reported to the caller
 * (`success: false`) so it can fail the request instead of recording a dead link.
 */
export const PHI_STORAGE_FOLDERS: readonly string[] = [
  'documents',
  'medical-records',
  'invoices',
  'prescriptions',
];

/** True when `folder` (or the first segment of a nested folder path) holds PHI. */
export function isPhiStorageFolder(folder: string): boolean {
  const top = folder.split('/')[0] ?? '';
  return PHI_STORAGE_FOLDERS.includes(top);
}

/** True when `storedUrl` starts with one of our own URL prefixes (case-insensitive). */
export function startsWithOwnedPrefix(
  storedUrl: string | null | undefined,
  ownedPrefixes: readonly string[]
): boolean {
  const lowered = (storedUrl ?? '').trim().toLowerCase();
  return (
    lowered.length > 0 && ownedPrefixes.some(prefix => lowered.startsWith(prefix.toLowerCase()))
  );
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some(char => {
    const code = char.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}

/**
 * Object key of `storedUrl` when it points into one of `ownedPrefixes` AND the
 * key lives under one of `allowedFolders` (`<folder>/<...>`); null otherwise
 * (foreign hosts, other folders, traversal, encoded separators, empty values).
 *
 * The prefix comparison is case-insensitive (scheme and host are); the returned
 * key keeps the stored casing. Nothing is percent-decoded: our writers never
 * encode the key, so a `%` can only come from a tampered value.
 */
export function extractOwnedObjectKey(
  storedUrl: string | null | undefined,
  ownedPrefixes: readonly string[],
  allowedFolders: readonly string[]
): string | null {
  const value = (storedUrl ?? '').trim();
  if (value.length === 0) {
    return null;
  }

  const lowered = value.toLowerCase();
  const prefix = ownedPrefixes.find(candidate => lowered.startsWith(candidate.toLowerCase()));
  if (!prefix) {
    return null;
  }

  const key = value.slice(prefix.length).split(/[?#]/)[0] ?? '';
  if (key.length === 0 || key.includes('\\') || key.includes('%') || hasControlCharacter(key)) {
    return null;
  }

  const segments = key.split('/');
  if (segments.length < 2 || segments.some(s => s === '' || s === '.' || s === '..')) {
    return null;
  }
  const folder = segments[0];
  if (folder === undefined || !allowedFolders.includes(folder)) {
    return null;
  }
  return key;
}

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
  /**
   * S3 was configured (S3_ENABLED=true) at startup. Unlike `config.enabled` this is not
   * cleared when the client fails to initialise, so PHI is still refused local storage
   * while S3 is intended but unavailable.
   */
  private readonly s3Configured: boolean;

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    const provider = this.configService.get<string>('S3_PROVIDER', 'contabo') as
      'contabo' | 'aws' | 'wasabi' | 'custom';
    const endpoint = this.configService.get<string>('S3_ENDPOINT');
    const region = this.configService.get<string>(
      'S3_REGION',
      provider === 'contabo' ? 'eu-central-1' : 'us-east-1'
    );

    const accessKeyId =
      this.configService.get<string>('S3_ACCESS_KEY_ID') ||
      this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const bucket = this.configService.get<string>('S3_BUCKET', '');

    // Auto-generate Contabo CDN URL if provider is Contabo and CDN_URL not explicitly set
    let cdnUrl = this.configService.get<string>('CDN_URL', '');
    if (!cdnUrl && provider === 'contabo' && endpoint && accessKeyId && bucket) {
      // Contabo CDN URL format: https://{endpoint}/{access-key-id}:{bucket}
      // Example: https://eu2.contabostorage.com/{access-key-id}:healthcaredata
      const endpointUrl = endpoint.replace(/\/$/, ''); // Remove trailing slash
      cdnUrl = `${endpointUrl}/${accessKeyId}:${bucket}`;
    }

    this.config = {
      enabled: this.configService.get<boolean>('S3_ENABLED', false),
      provider,
      endpoint,
      region,
      bucket,
      accessKeyId,
      secretAccessKey:
        this.configService.get<string>('S3_SECRET_ACCESS_KEY') ||
        this.configService.get<string>('AWS_SECRET_ACCESS_KEY'),
      forcePathStyle: this.configService.get<boolean>('S3_FORCE_PATH_STYLE', provider !== 'aws'),
      cdnUrl,
      publicUrlExpiration: this.configService.get<number>('S3_PUBLIC_URL_EXPIRATION', 3600),
    };

    // Same truthiness the rest of this service uses for `config.enabled`.
    this.s3Configured = Boolean(this.config.enabled) && Boolean(this.config.bucket);

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
        // Fall through to local storage (non-PHI assets only, see below)
      }
    }

    // PHI never lands on the pod-local disk while S3 is configured: report the failure so
    // the caller fails the request (and writes no row) instead of storing a dead,
    // possibly publicly served, `/storage/...` link.
    if (this.s3Configured && isPhiStorageFolder(folder)) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'PHI upload refused: S3 is configured but the object could not be stored there; local fallback is disabled for this folder',
        'S3StorageService.uploadFile',
        { folder, fileName, s3Initialized: this.s3Client !== null }
      );
      return {
        success: false,
        error: 'Object storage is unavailable; protected files are not stored locally',
      };
    }

    // Fallback to local storage (S3 not configured, or a non-PHI asset such as a QR code)
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
   *
   * CDN URL Priority:
   * 1. Uses CDN_URL if explicitly configured (environment variable)
   * 2. For Contabo provider: Auto-generates CDN URL from endpoint, access key, and bucket
   * 3. Falls back to direct S3 URLs if CDN not available
   */
  private generatePublicUrl(key: string, isPublic: boolean): string {
    // Use CDN URL if configured (includes auto-generated Contabo CDN)
    if (this.config.cdnUrl) {
      // Trim a trailing slash of CDN_URL: `https://cdn//documents/x` is neither
      // fetchable nor recognised by `extractOwnedObjectKey` (empty path segment).
      return `${trimTrailingSlashes(this.config.cdnUrl)}/${key}`;
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
   * Short-lived presigned GET for a PRIVATE object (default 15 minutes, clamped
   * to the 1 second .. 7 days S3 accepts). Works for legacy public-read objects
   * too. The returned URL is a bearer credential: never log it.
   */
  async getSignedDownloadUrl(
    key: string,
    ttlSeconds: number = PRIVATE_ASSET_URL_TTL_SECONDS
  ): Promise<string> {
    return await this.getPublicUrl(key, clampPresignTtl(ttlSeconds));
  }

  /**
   * Object key behind a stored `fileUrl`, or null when the URL does not point
   * into OUR bucket under one of `allowedFolders` (so it is never presigned).
   */
  resolveOwnedObjectKey(storedUrl: string, allowedFolders: readonly string[]): string | null {
    const ownedPrefixes = buildOwnedUrlPrefixes(this.config);
    const key = extractOwnedObjectKey(storedUrl, ownedPrefixes, allowedFolders);
    if (key === null && startsWithOwnedPrefix(storedUrl, ownedPrefixes)) {
      // The value claims to be one of OUR objects but is not a signable key (malformed,
      // wrong folder, traversal, encoded separators). It will not be presigned, so the
      // client gets a dead private URL: make that visible. The URL itself is never logged.
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'A stored URL points into our bucket but is not a signable object key; it will not be presigned',
        'S3StorageService.resolveOwnedObjectKey',
        { allowedFolders: [...allowedFolders] }
      );
    }
    return key;
  }

  /**
   * Presigned GET for a private object with response-header overrides, so the
   * browser receives the stored MIME type and a `Content-Disposition` chosen by
   * the caller (inline preview vs. attachment download with a friendly name).
   */
  async getPresignedDownloadUrl(
    key: string,
    options: {
      expiresIn?: number;
      contentType?: string;
      disposition?: 'inline' | 'attachment';
      fileName?: string;
    } = {}
  ): Promise<string> {
    if (!this.s3Client || !this.config.bucket) {
      throw new Error('S3 client not initialized');
    }

    const disposition = options.disposition ?? 'inline';
    const contentDisposition = options.fileName
      ? `${disposition}; filename="${options.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(options.fileName)}`
      : disposition;

    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ResponseContentDisposition: contentDisposition,
      ...(options.contentType ? { ResponseContentType: options.contentType } : {}),
    });

    // Type assertion - verified safe by TypeScript compilation
    const client = this.s3Client as S3Client;
    return await getSignedUrl(client, command, {
      expiresIn: options.expiresIn ?? this.config.publicUrlExpiration ?? 3600,
    });
  }

  /**
   * Delete file from S3 or local storage
   */
  async deleteFile(key: string): Promise<boolean> {
    // Try S3 first (if key doesn't start with s3:// and S3 is enabled). Local references
    // (relative `/storage/...` URL or an absolute disk path) are never valid S3 keys: an
    // S3 DeleteObject for them "succeeds" without removing anything.
    if (
      this.config.enabled &&
      this.s3Client &&
      !key.startsWith('s3://') &&
      !key.startsWith('/storage/') &&
      !path.isAbsolute(key)
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
