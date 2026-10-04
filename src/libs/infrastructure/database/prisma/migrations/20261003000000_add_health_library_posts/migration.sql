-- Health Library: clinic-authored wellness articles & videos shown to patients
-- in the mobile app (schema.prisma `HealthLibraryPost`, table health_library_posts).
-- Adds: 3 enums, the table, its indexes and the clinic/author foreign keys.
-- Idempotent and self-healing: safe to re-run, and safe on databases where an
-- older `prisma db push` shape of the enums/table already exists. CREATE TYPE /
-- CREATE TABLE IF NOT EXISTS alone would silently keep that older shape, so every
-- enum value and every non-key column is also (re)asserted with
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS below.
-- Postgres >= 12 allows ADD VALUE IF NOT EXISTS inside the transaction Prisma
-- wraps this file in. A value added here is never referenced elsewhere in this
-- file except as a column DEFAULT (the first value of each enum), which every
-- earlier enum shape already contained.

-- 1. Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HealthLibraryTab') THEN
    CREATE TYPE "HealthLibraryTab" AS ENUM ('ARTICLES', 'GUIDES', 'PRACTICES', 'COURSES');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HealthLibraryMediaType') THEN
    CREATE TYPE "HealthLibraryMediaType" AS ENUM ('ARTICLE', 'VIDEO');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HealthLibraryStatus') THEN
    CREATE TYPE "HealthLibraryStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
  END IF;
END $$;

-- 1b. Enum values: add any value an older enum shape lacks (no-op when present).
ALTER TYPE "HealthLibraryTab" ADD VALUE IF NOT EXISTS 'ARTICLES';
ALTER TYPE "HealthLibraryTab" ADD VALUE IF NOT EXISTS 'GUIDES';
ALTER TYPE "HealthLibraryTab" ADD VALUE IF NOT EXISTS 'PRACTICES';
ALTER TYPE "HealthLibraryTab" ADD VALUE IF NOT EXISTS 'COURSES';
ALTER TYPE "HealthLibraryMediaType" ADD VALUE IF NOT EXISTS 'ARTICLE';
ALTER TYPE "HealthLibraryMediaType" ADD VALUE IF NOT EXISTS 'VIDEO';
ALTER TYPE "HealthLibraryStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "HealthLibraryStatus" ADD VALUE IF NOT EXISTS 'PUBLISHED';
ALTER TYPE "HealthLibraryStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

-- 2. Table
CREATE TABLE IF NOT EXISTS "health_library_posts" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "tab" "HealthLibraryTab" NOT NULL DEFAULT 'ARTICLES',
  "mediaType" "HealthLibraryMediaType" NOT NULL DEFAULT 'ARTICLE',
  "status" "HealthLibraryStatus" NOT NULL DEFAULT 'DRAFT',
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "readTime" TEXT,
  "summary" TEXT NOT NULL,
  "coverImageUrl" TEXT,
  "coverImageKey" TEXT,
  "videoUrl" TEXT,
  "videoDurationSeconds" INTEGER,
  "sections" JSONB,
  "whenToSeeDoctor" TEXT,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "health_library_posts_pkey" PRIMARY KEY ("id")
);

-- 2b. Columns: add any column an older table shape lacks (no-op when present).
-- Definitions mirror what Prisma emits for the model. The NOT NULL columns without
-- a schema default (clinicId, authorId, title, category, summary, updatedAt) are
-- deliberately left exactly as the model dictates: they exist in every earlier
-- shape of this table, and inventing a backfill value for them would be wrong.
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "clinicId" TEXT NOT NULL;
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "authorId" TEXT NOT NULL;
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "tab" "HealthLibraryTab" NOT NULL DEFAULT 'ARTICLES';
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "mediaType" "HealthLibraryMediaType" NOT NULL DEFAULT 'ARTICLE';
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "status" "HealthLibraryStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "title" TEXT NOT NULL;
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL;
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "readTime" TEXT;
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "summary" TEXT NOT NULL;
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "coverImageUrl" TEXT;
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "coverImageKey" TEXT;
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "videoUrl" TEXT;
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "videoDurationSeconds" INTEGER;
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "sections" JSONB;
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "whenToSeeDoctor" TEXT;
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "viewCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL;
ALTER TABLE "health_library_posts" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- 3. Indexes
-- The list query filters (clinicId, status[, tab]) and orders by publishedAt DESC.
-- The earlier (clinicId, status, tab) index only existed on databases built via
-- `prisma db push`; it is superseded by the publishedAt-aware composite below.
DROP INDEX IF EXISTS "health_library_posts_clinicId_status_tab_idx";

CREATE INDEX IF NOT EXISTS "health_library_posts_clinicId_status_tab_publishedAt_idx" ON "health_library_posts"("clinicId", "status", "tab", "publishedAt" DESC);
CREATE INDEX IF NOT EXISTS "health_library_posts_clinicId_status_publishedAt_idx" ON "health_library_posts"("clinicId", "status", "publishedAt");
CREATE INDEX IF NOT EXISTS "health_library_posts_authorId_idx" ON "health_library_posts"("authorId");

-- 4. Foreign keys (clinics / users), guarded by a pg_constraint existence check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'health_library_posts_clinicId_fkey'
      AND conrelid = '"health_library_posts"'::regclass
  ) THEN
    ALTER TABLE "health_library_posts"
      ADD CONSTRAINT "health_library_posts_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'health_library_posts_authorId_fkey'
      AND conrelid = '"health_library_posts"'::regclass
  ) THEN
    ALTER TABLE "health_library_posts"
      ADD CONSTRAINT "health_library_posts_authorId_fkey"
      FOREIGN KEY ("authorId") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
