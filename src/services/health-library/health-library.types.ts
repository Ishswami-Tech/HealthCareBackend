/**
 * Internal types for the Health Library service (row shape, delegate, actor).
 * Public request/response contracts live in `@dtos/health-library.dto`.
 */

import type {
  PrismaDelegateArgs,
  PrismaTransactionClientWithDelegates,
} from '@core/types/prisma.types';
import type {
  HealthLibraryMediaTypeValue,
  HealthLibrarySectionResponse,
  HealthLibraryStatusValue,
  HealthLibraryTabValue,
} from '@dtos/health-library.dto';

/** The authenticated caller, as resolved by the controller from the JWT. */
export interface HealthLibraryActor {
  userId?: string;
  role?: string;
}

export interface HealthLibraryAuthorRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
}

export interface HealthLibraryPostRow {
  id: string;
  clinicId: string;
  authorId: string;
  tab: HealthLibraryTabValue;
  mediaType: HealthLibraryMediaTypeValue;
  status: HealthLibraryStatusValue;
  title: string;
  category: string;
  readTime: string | null;
  summary: string;
  coverImageUrl: string | null;
  coverImageKey: string | null;
  videoUrl: string | null;
  videoDurationSeconds: number | null;
  sections: HealthLibrarySectionResponse[] | null;
  whenToSeeDoctor: string | null;
  viewCount: number;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  author?: HealthLibraryAuthorRow | null;
}

export interface HealthLibraryPostDelegate {
  create: (args: PrismaDelegateArgs) => Promise<HealthLibraryPostRow>;
  findFirst: (args: PrismaDelegateArgs) => Promise<HealthLibraryPostRow | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<HealthLibraryPostRow[]>;
  update: (args: PrismaDelegateArgs) => Promise<HealthLibraryPostRow>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args: PrismaDelegateArgs) => Promise<number>;
}

export type HealthLibraryClient = PrismaTransactionClientWithDelegates & {
  healthLibraryPost: HealthLibraryPostDelegate;
};
