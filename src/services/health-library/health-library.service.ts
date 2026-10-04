/**
 * Health Library Service
 * @module HealthLibraryService
 *
 * Clinic-authored wellness content (articles & videos) shown to patients in
 * the mobile app's Health Library. Backed by `health_library_posts`
 * (schema.prisma `HealthLibraryPost`).
 *
 * Lifecycle: every post is created as DRAFT, then explicitly PUBLISHED or
 * ARCHIVED via dedicated endpoints — a generic update never changes status.
 * Transitions are compare-and-set writes (`status: { not: target }` in the
 * `where`), so of two concurrent publishes (or archives) exactly one wins and
 * emits its event; the other gets a 409. Publishing an already-published post
 * (or archiving an already-archived one) is likewise a 409, and an ARTICLE can
 * only be published with at least one non-empty section (a VIDEO needs its
 * videoUrl).
 *
 * A patient read of a PUBLISHED post counts one view per reader per post per
 * hour (de-duplicated through a CacheService lock; if the cache is unreachable
 * the read still succeeds, it just isn't counted).
 *
 * Non-authoring callers (patients, and any role without author-capable
 * guards) are always forced to `status=PUBLISHED` server-side, regardless of
 * what the `status` query param asks for, a non-PUBLISHED post 404s for them
 * instead of leaking that it exists, and `authorId` is never returned to them.
 *
 * Cover images are public (not PHI) and stored via StaticAssetService under
 * `AssetType.LIBRARY_COVER` with `isPublic=true`, so the returned URL is used
 * directly by clients. The upload endpoint is the ONLY way to set a cover: the
 * image type is verified from its magic bytes, the storage result must be an
 * absolute https URL with an object key (the S3 service silently falls back to
 * local disk otherwise), and the stored object is cleaned up on any failure,
 * on replacement and on soft delete. Replacement is a compare-and-set on the
 * previous `coverImageKey` (bounded retries), so concurrent uploads can never
 * orphan an object or delete one the row still references.
 */

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CacheService } from '@infrastructure/cache/cache.service';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';
import { AssetType, StaticAssetService } from '@infrastructure/storage/static-asset.service';
import { LogLevel, LogType } from '@core/types';
import type { AuditInfo, PrismaTransactionClient } from '@core/types/database.types';
import type { PrismaDelegateArgs } from '@core/types/prisma.types';
import type {
  CreateHealthLibraryPostDto,
  HealthLibraryListResponse,
  HealthLibraryPostResponse,
  HealthLibraryStatusValue,
  ListHealthLibraryQueryDto,
  UpdateHealthLibraryPostDto,
} from '@dtos/health-library.dto';
import {
  assertPublishable,
  assertValidForMediaType,
  computeReadTime,
  toSectionData,
} from '@services/health-library/health-library-content.util';
import type { PublishableContent } from '@services/health-library/health-library-content.util';
import { toHealthLibraryResponse } from '@services/health-library/health-library.mapper';
import type { MulterFile } from '@services/patient-visits/utils/fastify-file.decorator';
import {
  isAbsoluteHttpsUrl,
  storedObjectRef,
  validateCoverUpload,
} from '@services/health-library/health-library-cover.util';
import type { DetectedCoverImage } from '@services/health-library/health-library-cover.util';
import type {
  HealthLibraryActor,
  HealthLibraryClient,
  HealthLibraryPostDelegate,
  HealthLibraryPostRow,
} from '@services/health-library/health-library.types';

export type { HealthLibraryActor } from '@services/health-library/health-library.types';

const SERVICE_NAME = 'HealthLibraryService';
const RESOURCE_TYPE = 'HEALTH_LIBRARY_POST';
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const SYSTEM_ACTOR = 'system';
/** One counted view per reader per post per hour. */
const VIEW_DEDUPE_TTL_SECONDS = 60 * 60;
const VIEW_DEDUPE_KEY_PREFIX = 'lock:health-library:view';
/** Compare-and-set attempts for a cover replacement before giving up with a 409. */
const MAX_COVER_UPDATE_ATTEMPTS = 3;

const AUTHOR_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  role: true,
} as PrismaDelegateArgs;

interface StoredCover {
  url: string;
  key: string;
}

@Injectable()
export class HealthLibraryService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly staticAssetService: StaticAssetService,
    private readonly cacheService: CacheService
  ) {}

  async create(
    dto: CreateHealthLibraryPostDto,
    clinicId: string,
    actor: HealthLibraryActor
  ): Promise<HealthLibraryPostResponse> {
    const authorId = this.requireActorId(actor);
    const mediaType = dto.mediaType ?? 'ARTICLE';
    assertValidForMediaType(mediaType, dto.videoUrl);

    const sections = dto.sections ?? [];
    const row = await this.databaseService.executeHealthcareWrite<HealthLibraryPostRow>(
      async client =>
        this.postDelegate(client).create({
          data: {
            clinicId,
            authorId,
            tab: dto.tab,
            mediaType,
            status: 'DRAFT',
            title: dto.title.trim(),
            category: dto.category.trim(),
            readTime:
              dto.readTime?.trim() ||
              computeReadTime(mediaType, dto.videoDurationSeconds, sections),
            summary: dto.summary.trim(),
            videoUrl: dto.videoUrl ?? null,
            videoDurationSeconds: dto.videoDurationSeconds ?? null,
            sections: toSectionData(sections),
            whenToSeeDoctor: dto.whenToSeeDoctor?.trim() || null,
          } as PrismaDelegateArgs,
          include: { author: { select: AUTHOR_SELECT } },
        } as PrismaDelegateArgs),
      this.auditInfo(actor, clinicId, 'CREATE', 'pending', { tab: dto.tab, mediaType })
    );

    await this.eventService.emit('health-library.created', {
      postId: row.id,
      clinicId,
      authorId,
      tab: row.tab,
      mediaType: row.mediaType,
    });
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Health library post created',
      SERVICE_NAME,
      { postId: row.id, clinicId, authorId, tab: row.tab, mediaType: row.mediaType }
    );

    return toHealthLibraryResponse(row, true);
  }

  async list(
    query: ListHealthLibraryQueryDto,
    clinicId: string,
    canSeeUnpublished: boolean
  ): Promise<HealthLibraryListResponse> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const offset = Math.max(query.offset ?? 0, 0);
    const status = canSeeUnpublished ? (query.status ?? undefined) : 'PUBLISHED';
    const search = query.search?.trim();

    const where = {
      clinicId,
      deletedAt: null,
      ...(status ? { status } : {}),
      ...(query.tab ? { tab: query.tab } : {}),
      ...(query.mediaType ? { mediaType: query.mediaType } : {}),
      ...(query.category ? { category: { equals: query.category, mode: 'insensitive' } } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { summary: { contains: search, mode: 'insensitive' } },
              { category: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    } as PrismaDelegateArgs;

    const result = await this.databaseService.executeHealthcareRead<{
      rows: HealthLibraryPostRow[];
      total: number;
    }>(async client => {
      const delegate = this.postDelegate(client);
      const rows = await delegate.findMany({
        where,
        include: { author: { select: AUTHOR_SELECT } },
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        skip: offset,
      } as PrismaDelegateArgs);
      const total = await delegate.count({ where } as PrismaDelegateArgs);
      return { rows, total };
    });

    return {
      items: result.rows.map(row => toHealthLibraryResponse(row, canSeeUnpublished)),
      total: result.total,
    };
  }

  /**
   * Fetch one post. A view is counted only when a non-author role (e.g. a
   * patient) reads a PUBLISHED post — staff previews and drafts never count.
   */
  async getById(
    id: string,
    clinicId: string,
    canSeeUnpublished: boolean,
    actor: HealthLibraryActor
  ): Promise<HealthLibraryPostResponse> {
    const row = await this.findVisibleRow(id, clinicId, canSeeUnpublished);
    const shouldCountView = !canSeeUnpublished && row.status === 'PUBLISHED';
    const viewed = shouldCountView ? await this.recordView(row, clinicId, actor) : row;
    return toHealthLibraryResponse(viewed, canSeeUnpublished);
  }

  async update(
    id: string,
    clinicId: string,
    dto: UpdateHealthLibraryPostDto,
    actor: HealthLibraryActor
  ): Promise<HealthLibraryPostResponse> {
    const existing = await this.findVisibleRow(id, clinicId, true);
    const next: PublishableContent = {
      mediaType: dto.mediaType ?? existing.mediaType,
      videoUrl: dto.videoUrl !== undefined ? dto.videoUrl : existing.videoUrl,
      sections: dto.sections !== undefined ? dto.sections : existing.sections,
    };
    // A live post must stay complete: editing it can't strip the content that
    // publishing required.
    if (existing.status === 'PUBLISHED') {
      assertPublishable(next);
    } else {
      assertValidForMediaType(next.mediaType, next.videoUrl);
    }

    const data = {
      ...(dto.tab !== undefined && { tab: dto.tab }),
      ...(dto.mediaType !== undefined && { mediaType: dto.mediaType }),
      ...(dto.title !== undefined && { title: dto.title.trim() }),
      ...(dto.category !== undefined && { category: dto.category.trim() }),
      ...this.readTimePatch(dto, existing),
      ...(dto.summary !== undefined && { summary: dto.summary.trim() }),
      ...(dto.videoUrl !== undefined && { videoUrl: dto.videoUrl || null }),
      ...(dto.videoDurationSeconds !== undefined && {
        videoDurationSeconds: dto.videoDurationSeconds ?? null,
      }),
      ...(dto.sections !== undefined && { sections: toSectionData(dto.sections) }),
      ...(dto.whenToSeeDoctor !== undefined && {
        whenToSeeDoctor: dto.whenToSeeDoctor?.trim() || null,
      }),
    } as PrismaDelegateArgs;

    if (Object.keys(data).length === 0) {
      return toHealthLibraryResponse(existing, true);
    }

    const row = await this.updateRow(
      id,
      clinicId,
      data,
      this.auditInfo(actor, clinicId, 'UPDATE', id, { updateFields: Object.keys(data) })
    );

    await this.eventService.emit('health-library.updated', { postId: id, clinicId });
    return toHealthLibraryResponse(this.requireRow(row, id), true);
  }

  async publish(
    id: string,
    clinicId: string,
    actor: HealthLibraryActor
  ): Promise<HealthLibraryPostResponse> {
    const existing = await this.findVisibleRow(id, clinicId, true);
    if (existing.status === 'PUBLISHED') {
      throw new ConflictException(`Health library post ${id} is already published`);
    }
    assertPublishable(existing);

    const response = await this.transitionStatus(id, clinicId, 'PUBLISHED', actor, {
      publishedAt: existing.publishedAt ?? new Date(),
    });
    // Only the winning call reaches this point: a losing compare-and-set throws 409.
    await this.eventService.emit('health-library.published', { postId: id, clinicId });
    return response;
  }

  async archive(
    id: string,
    clinicId: string,
    actor: HealthLibraryActor
  ): Promise<HealthLibraryPostResponse> {
    const existing = await this.findVisibleRow(id, clinicId, true);
    if (existing.status === 'ARCHIVED') {
      throw new ConflictException(`Health library post ${id} is already archived`);
    }

    const response = await this.transitionStatus(id, clinicId, 'ARCHIVED', actor);
    await this.eventService.emit('health-library.archived', { postId: id, clinicId });
    return response;
  }

  /** Soft delete: marks the row deleted and (best effort) removes its stored cover image. */
  async softDelete(id: string, clinicId: string, actor: HealthLibraryActor): Promise<void> {
    await this.findVisibleRow(id, clinicId, true);

    const row = this.requireRow(
      await this.updateRow(
        id,
        clinicId,
        { deletedAt: new Date(), status: 'ARCHIVED' } as PrismaDelegateArgs,
        this.auditInfo(actor, clinicId, 'DELETE', id, { softDelete: true })
      ),
      id
    );

    await this.eventService.emit('health-library.deleted', { postId: id, clinicId });
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Health library post soft-deleted',
      SERVICE_NAME,
      { postId: id, clinicId }
    );
    // The key on the row after the delete is the one that is actually referenced:
    // a cover swap can no longer succeed once `deletedAt` is set, so unlike the
    // key read before the write it can't be stale.
    await this.discardStoredObject(row.coverImageKey ?? undefined, id, clinicId, 'post deleted');
  }

  async setCoverImage(
    id: string,
    clinicId: string,
    file: MulterFile | null,
    actor: HealthLibraryActor
  ): Promise<HealthLibraryPostResponse> {
    const image = validateCoverUpload(file);
    const existing = await this.findVisibleRow(id, clinicId, true);
    const stored = await this.storeCoverImage(id, clinicId, image.buffer, image.type);

    let committed = false;
    try {
      const { row, replacedKey } = await this.swapCover(
        id,
        clinicId,
        stored,
        existing.coverImageKey,
        actor
      );
      committed = true;
      // `replacedKey` is the value the winning write actually replaced, so it is
      // no longer referenced by the row and safe to remove.
      if (replacedKey && replacedKey !== stored.key) {
        await this.discardStoredObject(replacedKey, id, clinicId, 'cover replaced');
      }
      return toHealthLibraryResponse(row, true);
    } finally {
      if (!committed) {
        // The DB never learned about the new object (error, post gone, or lost
        // every compare-and-set attempt) — don't leave it orphaned.
        await this.discardStoredObject(stored.key, id, clinicId, 'cover update did not commit');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cover image handling
  // ---------------------------------------------------------------------------

  /**
   * Uploads the cover and guarantees the result is usable by clients: an
   * absolute https URL plus an object key. Anything else (e.g. the local-disk
   * fallback's relative `/storage/...` URL with no key) is cleaned up and rejected.
   */
  private async storeCoverImage(
    id: string,
    clinicId: string,
    buffer: Buffer,
    type: DetectedCoverImage
  ): Promise<StoredCover> {
    const uploaded = await this.staticAssetService.uploadFile(
      buffer,
      `${id}-${Date.now()}.${type.extension}`,
      AssetType.LIBRARY_COVER,
      type.mimeType,
      true
    );
    if (!uploaded.success) {
      throw new InternalServerErrorException('Could not store the cover image');
    }

    if (!isAbsoluteHttpsUrl(uploaded.url) || !uploaded.key) {
      await this.logWarning('Cover image storage returned an unusable result; discarding it', {
        postId: id,
        clinicId,
        hasKey: Boolean(uploaded.key),
        hasUrl: Boolean(uploaded.url),
        isHttpsUrl: isAbsoluteHttpsUrl(uploaded.url),
      });
      await this.discardStoredObject(storedObjectRef(uploaded), id, clinicId, 'unusable upload');
      throw new InternalServerErrorException(
        'Could not store the cover image: public object storage is unavailable'
      );
    }

    return { url: uploaded.url, key: uploaded.key };
  }

  /** Best-effort object removal: failures are logged, never thrown. */
  private async discardStoredObject(
    ref: string | undefined,
    postId: string,
    clinicId: string,
    reason: string
  ): Promise<void> {
    if (!ref) {
      return;
    }
    try {
      const deleted = await this.staticAssetService.deleteAsset(ref);
      if (!deleted) {
        await this.logWarning(`Health library cover object was not deleted (${reason})`, {
          postId,
          clinicId,
          key: ref,
        });
      }
    } catch (error) {
      await this.logWarning(`Health library cover object delete failed (${reason})`, {
        postId,
        clinicId,
        key: ref,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------------------

  private postDelegate(client: PrismaTransactionClient): HealthLibraryPostDelegate {
    return (client as unknown as HealthLibraryClient).healthLibraryPost;
  }

  private async findLiveRow(id: string, clinicId: string): Promise<HealthLibraryPostRow | null> {
    return this.databaseService.executeHealthcareRead<HealthLibraryPostRow | null>(async client =>
      this.postDelegate(client).findFirst({
        where: { id, clinicId, deletedAt: null } as PrismaDelegateArgs,
        include: { author: { select: AUTHOR_SELECT } },
      } as PrismaDelegateArgs)
    );
  }

  private async findVisibleRow(
    id: string,
    clinicId: string,
    canSeeUnpublished: boolean
  ): Promise<HealthLibraryPostRow> {
    const row = await this.findLiveRow(id, clinicId);
    if (!row || (!canSeeUnpublished && row.status !== 'PUBLISHED')) {
      throw this.notFound(id);
    }
    return row;
  }

  /**
   * Scoped update: the write only matches a live row of this clinic, so a stale
   * pre-check (concurrent delete) can never touch another clinic's or a deleted
   * row. `guard` adds compare-and-set conditions (e.g. the status or cover key
   * the caller read) to that `where`, so a stale read loses atomically instead
   * of overwriting. Resolves to the updated row, or null when nothing matched.
   */
  private async updateRow(
    id: string,
    clinicId: string,
    data: PrismaDelegateArgs,
    audit: AuditInfo,
    guard: PrismaDelegateArgs = {}
  ): Promise<HealthLibraryPostRow | null> {
    return this.databaseService.executeHealthcareWrite<HealthLibraryPostRow | null>(
      async client => {
        const delegate = this.postDelegate(client);
        const { count } = await delegate.updateMany({
          where: { id, clinicId, deletedAt: null, ...guard } as PrismaDelegateArgs,
          data,
        } as PrismaDelegateArgs);
        if (count === 0) {
          return null;
        }
        return delegate.findFirst({
          where: { id, clinicId } as PrismaDelegateArgs,
          include: { author: { select: AUTHOR_SELECT } },
        } as PrismaDelegateArgs);
      },
      audit
    );
  }

  /**
   * Compare-and-set status transition: the write only matches while the row is
   * NOT already in `target`. When it loses, a re-read tells "post is gone" (404)
   * apart from "someone already moved it there" (409).
   */
  private async transitionStatus(
    id: string,
    clinicId: string,
    target: HealthLibraryStatusValue,
    actor: HealthLibraryActor,
    extra: PrismaDelegateArgs = {}
  ): Promise<HealthLibraryPostResponse> {
    const row = await this.updateRow(
      id,
      clinicId,
      { status: target, ...extra } as PrismaDelegateArgs,
      this.auditInfo(actor, clinicId, 'UPDATE', id, { status: target }),
      { status: { not: target } } as PrismaDelegateArgs
    );
    if (row) {
      return toHealthLibraryResponse(row, true);
    }

    const current = await this.findLiveRow(id, clinicId);
    if (!current) {
      throw this.notFound(id);
    }
    throw new ConflictException(
      current.status === target
        ? `Health library post ${id} is already ${target.toLowerCase()}`
        : `Health library post ${id} was changed by another request; reload and retry`
    );
  }

  /**
   * Points the post at the freshly stored cover with a compare-and-set on the
   * `coverImageKey` the caller last saw. On a lost race the current key is
   * re-read and the swap retried (bounded); the key a winning swap actually
   * replaced is returned so exactly that object can be removed. A post that has
   * disappeared is a 404, exhausting the attempts a 409 — in both cases the
   * caller discards the new object.
   */
  private async swapCover(
    id: string,
    clinicId: string,
    stored: StoredCover,
    initialKey: string | null,
    actor: HealthLibraryActor
  ): Promise<{ row: HealthLibraryPostRow; replacedKey: string | null }> {
    let expectedKey = initialKey;
    for (let attempt = 1; attempt <= MAX_COVER_UPDATE_ATTEMPTS; attempt += 1) {
      const row = await this.updateRow(
        id,
        clinicId,
        { coverImageUrl: stored.url, coverImageKey: stored.key } as PrismaDelegateArgs,
        this.auditInfo(actor, clinicId, 'UPDATE', id, { coverImage: true }),
        { coverImageKey: expectedKey } as PrismaDelegateArgs
      );
      if (row) {
        return { row, replacedKey: expectedKey };
      }
      const current = await this.findLiveRow(id, clinicId);
      if (!current) {
        throw this.notFound(id);
      }
      expectedKey = current.coverImageKey;
    }
    throw new ConflictException(
      `Health library post ${id} cover was changed by another request; please retry`
    );
  }

  /**
   * Counts one view of a PUBLISHED post by a non-author reader, at most once per
   * reader per post per hour: the reader first claims a CacheService lock slot
   * (SET NX with a one-hour TTL) and a deduped view skips the DB and audit
   * writes entirely. `acquireLock` answers false both when the slot is taken and
   * when the cache is unreachable, so an outage fails OPEN for the read (the post
   * is still served) but never counts. A slot whose write didn't count is
   * released again so the reader's next read can.
   *
   * The write opts out of the automatic cache invalidation (a counter must not
   * flush every cached read of the post) and re-sends the existing `updatedAt` so
   * a read never looks like an edit. It only matches while the row is unchanged,
   * so a concurrent edit can't have its `updatedAt` rolled back. Failures are
   * logged and never block the read.
   */
  private async recordView(
    row: HealthLibraryPostRow,
    clinicId: string,
    actor: HealthLibraryActor
  ): Promise<HealthLibraryPostRow> {
    if (!actor.userId) {
      return row;
    }
    const slotKey = `${VIEW_DEDUPE_KEY_PREFIX}:${clinicId}:${row.id}:${actor.userId}`;
    if (!(await this.claimViewSlot(slotKey, row.id, clinicId))) {
      return row;
    }

    try {
      const { count } = await this.databaseService.executeHealthcareWrite<{ count: number }>(
        async client =>
          this.postDelegate(client).updateMany({
            where: {
              id: row.id,
              clinicId,
              deletedAt: null,
              status: 'PUBLISHED',
              updatedAt: row.updatedAt,
            } as PrismaDelegateArgs,
            data: {
              viewCount: { increment: 1 },
              updatedAt: row.updatedAt,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs),
        this.auditInfo(actor, clinicId, 'VIEW', row.id, {}, true)
      );
      if (count > 0) {
        return { ...row, viewCount: row.viewCount + 1 };
      }
      await this.releaseViewSlot(slotKey, row.id, clinicId);
      return row;
    } catch (error) {
      await this.releaseViewSlot(slotKey, row.id, clinicId);
      await this.logWarning('Health library view count update failed', {
        postId: row.id,
        clinicId,
        error: error instanceof Error ? error.message : String(error),
      });
      return row;
    }
  }

  private async claimViewSlot(slotKey: string, postId: string, clinicId: string): Promise<boolean> {
    try {
      return await this.cacheService.acquireLock(slotKey, VIEW_DEDUPE_TTL_SECONDS);
    } catch (error) {
      await this.logWarning('Health library view de-duplication unavailable; view not counted', {
        postId,
        clinicId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async releaseViewSlot(slotKey: string, postId: string, clinicId: string): Promise<void> {
    try {
      await this.cacheService.releaseLock(slotKey);
    } catch (error) {
      await this.logWarning('Health library view slot release failed', {
        postId,
        clinicId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private auditInfo(
    actor: HealthLibraryActor,
    clinicId: string,
    operation: string,
    resourceId: string,
    details: Record<string, unknown>,
    skipCacheInvalidation = false
  ): AuditInfo {
    return {
      userId: actor.userId ?? SYSTEM_ACTOR,
      userRole: actor.role ?? SYSTEM_ACTOR,
      clinicId,
      resourceType: RESOURCE_TYPE,
      operation,
      resourceId,
      details,
      ...(skipCacheInvalidation ? { skipCacheInvalidation } : {}),
    };
  }

  private requireRow(row: HealthLibraryPostRow | null, id: string): HealthLibraryPostRow {
    if (!row) {
      throw this.notFound(id);
    }
    return row;
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException(`Health library post ${id} not found`);
  }

  // ---------------------------------------------------------------------------
  // Validation & mapping
  // ---------------------------------------------------------------------------

  private requireActorId(actor: HealthLibraryActor): string {
    if (!actor.userId) {
      throw new ForbiddenException('Authenticated user required');
    }
    return actor.userId;
  }

  /**
   * The `readTime` column write for an update. An explicit `readTime` always wins
   * (null/blank clears it); otherwise it is re-derived with the same calculation
   * `create` uses whenever something it depends on (sections, media type, video
   * duration) changes, so it can't go stale after a content edit.
   */
  private readTimePatch(
    dto: UpdateHealthLibraryPostDto,
    existing: HealthLibraryPostRow
  ): PrismaDelegateArgs {
    if (dto.readTime !== undefined) {
      return { readTime: dto.readTime?.trim() || null };
    }
    const contentChanged =
      dto.sections !== undefined ||
      dto.mediaType !== undefined ||
      dto.videoDurationSeconds !== undefined;
    if (!contentChanged) {
      return {};
    }
    return {
      readTime: computeReadTime(
        dto.mediaType ?? existing.mediaType,
        dto.videoDurationSeconds !== undefined
          ? dto.videoDurationSeconds
          : existing.videoDurationSeconds,
        dto.sections ?? existing.sections
      ),
    };
  }

  private async logWarning(message: string, metadata: Record<string, unknown>): Promise<void> {
    await this.loggingService.log(LogType.SYSTEM, LogLevel.WARN, message, SERVICE_NAME, metadata);
  }
}
