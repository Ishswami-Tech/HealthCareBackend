/**
 * Maps a persisted Health Library row to its public response shape.
 */

import type { HealthLibraryPostResponse } from '@dtos/health-library.dto';
import type { HealthLibraryPostRow } from '@services/health-library/health-library.types';

export function toHealthLibraryResponse(
  row: HealthLibraryPostRow,
  includeAuthorId: boolean
): HealthLibraryPostResponse {
  const authorName = row.author
    ? [row.author.firstName, row.author.lastName].filter(Boolean).join(' ').trim() || null
    : null;

  return {
    id: row.id,
    clinicId: row.clinicId,
    tab: row.tab,
    mediaType: row.mediaType,
    status: row.status,
    title: row.title,
    category: row.category,
    readTime: row.readTime ?? null,
    summary: row.summary,
    coverImageUrl: row.coverImageUrl ?? null,
    videoUrl: row.videoUrl ?? null,
    videoDurationSeconds: row.videoDurationSeconds ?? null,
    sections: Array.isArray(row.sections) ? row.sections : [],
    whenToSeeDoctor: row.whenToSeeDoctor ?? null,
    viewCount: row.viewCount,
    publishedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
    // Staff-only: patients never learn which user authored a post.
    ...(includeAuthorId ? { authorId: row.authorId } : {}),
    authorName,
    authorRole: row.author?.role ?? null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}
