/**
 * Pure content helpers for the Health Library: read-time estimation, section
 * completeness and section serialization. Kept free of Nest/Prisma so the same
 * calculation backs both `create` and `update`.
 */

import { BadRequestException } from '@nestjs/common';
import type { PrismaDelegateArgs } from '@core/types/prisma.types';
import { HEALTH_LIBRARY_MEDIA_TYPES } from '@dtos/health-library.dto';
import type {
  HealthLibraryMediaTypeValue,
  HealthLibrarySectionResponse,
} from '@dtos/health-library.dto';

const WORDS_PER_MINUTE = 200;
const SECONDS_PER_MINUTE = 60;

type SectionsInput = HealthLibrarySectionResponse[] | null | undefined;

/** The content a post must carry for its media type before it can go live. */
export interface PublishableContent {
  mediaType: HealthLibraryMediaTypeValue;
  videoUrl: string | null | undefined;
  sections: HealthLibrarySectionResponse[] | null | undefined;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Estimated "N min read" / "N min watch" label, or null when there is nothing to
 * estimate from. Sections may come straight from a JSON column, so malformed
 * entries are skipped instead of throwing.
 */
export function computeReadTime(
  mediaType: HealthLibraryMediaTypeValue,
  videoDurationSeconds: number | null | undefined,
  sections: SectionsInput
): string | null {
  if (mediaType === 'VIDEO') {
    if (!videoDurationSeconds) return null;
    const minutes = Math.max(1, Math.round(videoDurationSeconds / SECONDS_PER_MINUTE));
    return `${minutes} min watch`;
  }
  const words = (Array.isArray(sections) ? sections : []).reduce(
    (sum, section) => sum + (typeof section?.body === 'string' ? countWords(section.body) : 0),
    0
  );
  if (words === 0) return null;
  const minutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  return `${minutes} min read`;
}

/** True when at least one section has both a non-blank heading and a non-blank body. */
export function hasContentSection(sections: SectionsInput): boolean {
  return (
    Array.isArray(sections) &&
    sections.some(
      section =>
        typeof section?.heading === 'string' &&
        section.heading.trim().length > 0 &&
        typeof section.body === 'string' &&
        section.body.trim().length > 0
    )
  );
}

export function toSectionData(
  sections: readonly HealthLibrarySectionResponse[]
): PrismaDelegateArgs[] {
  return sections.map(({ heading, body }) => ({ heading, body }));
}

export function assertValidForMediaType(
  mediaType: HealthLibraryMediaTypeValue,
  videoUrl: string | null | undefined
): void {
  if (!HEALTH_LIBRARY_MEDIA_TYPES.includes(mediaType)) {
    throw new BadRequestException(
      `Invalid mediaType. Allowed: ${HEALTH_LIBRARY_MEDIA_TYPES.join(', ')}`
    );
  }
  if (mediaType === 'VIDEO' && !videoUrl) {
    throw new BadRequestException('videoUrl is required for VIDEO posts');
  }
}

/** A post may go live only when it has the content its media type promises. */
export function assertPublishable(content: PublishableContent): void {
  assertValidForMediaType(content.mediaType, content.videoUrl);
  if (content.mediaType === 'ARTICLE' && !hasContentSection(content.sections)) {
    throw new BadRequestException(
      'An ARTICLE needs at least one section with a heading and body before it can be published'
    );
  }
}
