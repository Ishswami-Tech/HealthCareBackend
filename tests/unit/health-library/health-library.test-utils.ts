/// <reference types="jest" />

/**
 * Shared test harness for the Health Library unit specs.
 *
 * DatabaseService is replaced by a thin fake that runs each callback against a
 * `healthLibraryPost` delegate of jest mocks, so specs assert the exact Prisma
 * `where` / `data` the service builds (clinic scoping, soft-delete filter, ...).
 *
 * `createHarness()` leaves the delegate mocks bare (specs stub results).
 * `createStatefulHarness(rows)` backs the very same mocks with an in-memory store
 * that honours the full `where` atomically (see health-library.fake-store.ts), so
 * race specs exercise real compare-and-set behaviour. The CacheService slice the
 * service uses is always a working in-memory fake (health-library.fake-cache.ts).
 */

import { HealthLibraryService } from '@services/health-library/health-library.service';
import type {
  HealthLibraryActor,
  HealthLibraryPostDelegate,
  HealthLibraryPostRow,
} from '@services/health-library/health-library.types';
import type { DatabaseService } from '@infrastructure/database';
import type { LoggingService } from '@infrastructure/logging';
import type { EventService } from '@infrastructure/events/event.service';
import type { AssetType, StaticAssetService } from '@infrastructure/storage/static-asset.service';
import type { UploadResult } from '@infrastructure/storage/s3-storage.service';
import type { CacheService } from '@infrastructure/cache/cache.service';
import type { AuditInfo, PrismaTransactionClient } from '@core/types/database.types';
import type { PrismaDelegateArgs } from '@core/types/prisma.types';
import type { MulterFile } from '@services/patient-visits/utils/fastify-file.decorator';
import { createFakeCache } from './health-library.fake-cache';
import type { FakeCache } from './health-library.fake-cache';
import { createPostStore } from './health-library.fake-store';
import type { PostStore, PostStoreOptions } from './health-library.fake-store';

export const CLINIC_ID = 'clinic-1';
export const POST_ID = 'post-1';

export const PATIENT: HealthLibraryActor = { userId: 'patient-1', role: 'PATIENT' };
export const DOCTOR: HealthLibraryActor = { userId: 'author-1', role: 'DOCTOR' };

export type DelegateMock = {
  [K in keyof HealthLibraryPostDelegate]: jest.Mock<
    ReturnType<HealthLibraryPostDelegate[K]>,
    Parameters<HealthLibraryPostDelegate[K]>
  >;
};

type DbOperation<T> = (client: PrismaTransactionClient) => Promise<T>;

export interface HealthLibraryHarness {
  service: HealthLibraryService;
  post: DelegateMock;
  cache: FakeCache;
  executeHealthcareRead: jest.Mock;
  executeHealthcareWrite: jest.Mock;
  emit: jest.Mock<Promise<void>, [string, object]>;
  log: jest.Mock;
  uploadFile: jest.Mock<
    Promise<UploadResult>,
    [Buffer, string, AssetType, string, (boolean | undefined)?]
  >;
  deleteAsset: jest.Mock<Promise<boolean>, [string]>;
  /** Audit info passed to the nth `executeHealthcareWrite` call (0-based). */
  auditOf: (callIndex?: number) => AuditInfo;
}

export interface StatefulHarness extends HealthLibraryHarness {
  store: PostStore;
}

function createDelegateMock(store?: PostStore): DelegateMock {
  if (!store) {
    return {
      create: jest.fn<Promise<HealthLibraryPostRow>, [PrismaDelegateArgs]>(),
      findFirst: jest.fn<Promise<HealthLibraryPostRow | null>, [PrismaDelegateArgs]>(),
      findMany: jest.fn<Promise<HealthLibraryPostRow[]>, [PrismaDelegateArgs]>(),
      update: jest.fn<Promise<HealthLibraryPostRow>, [PrismaDelegateArgs]>(),
      updateMany: jest.fn<Promise<{ count: number }>, [PrismaDelegateArgs]>(),
      count: jest.fn<Promise<number>, [PrismaDelegateArgs]>(),
    };
  }
  const { delegate } = store;
  return {
    create: jest.fn(delegate.create),
    findFirst: jest.fn(delegate.findFirst),
    findMany: jest.fn(delegate.findMany),
    update: jest.fn(delegate.update),
    updateMany: jest.fn(delegate.updateMany),
    count: jest.fn(delegate.count),
  };
}

export function createHarness(): HealthLibraryHarness {
  return buildHarness();
}

export function createStatefulHarness(
  rows: readonly HealthLibraryPostRow[],
  options?: PostStoreOptions
): StatefulHarness {
  const store = createPostStore(rows, options);
  return { ...buildHarness(store), store };
}

function buildHarness(store?: PostStore): HealthLibraryHarness {
  const post = createDelegateMock(store);
  const cache = createFakeCache();
  const client = { healthLibraryPost: post } as unknown as PrismaTransactionClient;

  const executeHealthcareRead = jest.fn(<T>(operation: DbOperation<T>): Promise<T> =>
    operation(client)
  );
  const executeHealthcareWrite = jest.fn(
    <T>(operation: DbOperation<T>, _audit: AuditInfo): Promise<T> => operation(client)
  );
  const emit = jest.fn<Promise<void>, [string, object]>().mockResolvedValue(undefined);
  const log = jest.fn().mockResolvedValue(undefined);
  const uploadFile = jest.fn<
    Promise<UploadResult>,
    [Buffer, string, AssetType, string, (boolean | undefined)?]
  >();
  const deleteAsset = jest.fn<Promise<boolean>, [string]>().mockResolvedValue(true);

  const service = new HealthLibraryService(
    { executeHealthcareRead, executeHealthcareWrite } as unknown as DatabaseService,
    { log } as unknown as LoggingService,
    { emit } as unknown as EventService,
    { uploadFile, deleteAsset } as unknown as StaticAssetService,
    cache as unknown as CacheService
  );

  return {
    service,
    post,
    cache,
    executeHealthcareRead,
    executeHealthcareWrite,
    emit,
    log,
    uploadFile,
    deleteAsset,
    auditOf: (callIndex = 0): AuditInfo => {
      const audit = executeHealthcareWrite.mock.calls[callIndex]?.[1] as AuditInfo | undefined;
      if (!audit) {
        throw new Error(`executeHealthcareWrite call #${callIndex} not found`);
      }
      return audit;
    },
  };
}

export function makeRow(overrides: Partial<HealthLibraryPostRow> = {}): HealthLibraryPostRow {
  return {
    id: POST_ID,
    clinicId: CLINIC_ID,
    authorId: 'author-1',
    tab: 'ARTICLES',
    mediaType: 'ARTICLE',
    status: 'PUBLISHED',
    title: '5 Everyday Habits for a Healthier Heart',
    category: 'Heart Health',
    readTime: '1 min read',
    summary: 'Small, steady routines add up.',
    coverImageUrl: null,
    coverImageKey: null,
    videoUrl: null,
    videoDurationSeconds: null,
    sections: [{ heading: 'Move a little', body: 'Walk for 30 minutes most days.' }],
    whenToSeeDoctor: null,
    viewCount: 3,
    publishedAt: new Date('2026-09-01T00:00:00.000Z'),
    createdAt: new Date('2026-08-30T00:00:00.000Z'),
    updatedAt: new Date('2026-09-02T00:00:00.000Z'),
    deletedAt: null,
    author: { id: 'author-1', firstName: 'Asha', lastName: 'Rao', role: 'DOCTOR' },
    ...overrides,
  };
}

const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_HEAD = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
]);
const BODY = Buffer.alloc(64, 1);

export const JPEG_BYTES = Buffer.concat([JPEG_HEAD, BODY]);
export const PNG_BYTES = Buffer.concat([PNG_HEAD, BODY]);
export const WEBP_BYTES = Buffer.concat([WEBP_HEAD, BODY]);
export const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.7\n'), BODY]);
export const GIF_BYTES = Buffer.concat([Buffer.from('GIF89a'), BODY]);

export function makeFile(buffer: Buffer, mimetype = 'image/jpeg'): MulterFile {
  return { buffer, mimetype, originalname: 'cover', size: buffer.length };
}

export interface FakeObjectStorage {
  /** Keys currently stored. */
  objects: () => string[];
  /** Keys deleteAsset was asked to remove, in order. */
  deleted: () => string[];
  /** Keys that were deleted while `isReferenced` said a row still pointed at them. */
  deletedWhileReferenced: () => string[];
}

/**
 * Makes `uploadFile`/`deleteAsset` behave like a real bucket: every upload gets a
 * fresh key and is added to the stored set, every delete removes its key.
 * `seedKeys` are objects that already exist (e.g. a post's current cover).
 */
export function installFakeObjectStorage(
  h: HealthLibraryHarness,
  seedKeys: readonly string[] = [],
  isReferenced: (key: string) => boolean = (): boolean => false
): FakeObjectStorage {
  const stored = new Set<string>(seedKeys);
  const deleted: string[] = [];
  const deletedWhileReferenced: string[] = [];
  let uploads = 0;

  h.uploadFile.mockImplementation(() => {
    uploads += 1;
    const key = `library-covers/upload-${uploads}.jpg`;
    stored.add(key);
    return Promise.resolve({ success: true, url: `https://cdn.example.com/${key}`, key });
  });
  h.deleteAsset.mockImplementation(key => {
    deleted.push(key);
    if (isReferenced(key)) {
      deletedWhileReferenced.push(key);
    }
    return Promise.resolve(stored.delete(key));
  });

  return {
    objects: () => [...stored].sort(),
    deleted: () => [...deleted],
    deletedWhileReferenced: () => [...deletedWhileReferenced],
  };
}

/** The rejection reasons of a Promise.allSettled result, typed as unknown for narrowing. */
export function rejectionsOf(results: readonly PromiseSettledResult<unknown>[]): unknown[] {
  const reasons: unknown[] = [];
  for (const result of results) {
    if (result.status === 'rejected') {
      reasons.push(result.reason as unknown);
    }
  }
  return reasons;
}
