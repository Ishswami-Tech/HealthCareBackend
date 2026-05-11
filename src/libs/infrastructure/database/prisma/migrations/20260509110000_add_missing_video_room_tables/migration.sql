-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "VideoMessageType" AS ENUM ('TEXT', 'IMAGE', 'DOCUMENT', 'PRESCRIPTION', 'FILE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "VideoNoteType" AS ENUM ('GENERAL', 'PRESCRIPTION', 'SYMPTOM', 'TREATMENT_PLAN', 'DIAGNOSIS');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "VideoAnnotationType" AS ENUM ('DRAWING', 'HIGHLIGHT', 'ARROW', 'TEXT', 'SHAPE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "WaitingRoomStatus" AS ENUM ('WAITING', 'ADMITTED', 'LEFT', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "video_annotations" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "annotationType" "VideoAnnotationType" NOT NULL DEFAULT 'DRAWING',
    "data" JSONB NOT NULL,
    "position" JSONB,
    "color" TEXT,
    "thickness" DOUBLE PRECISION,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_annotations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "video_annotations_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "video_consultations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "video_annotations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "video_chat_messages" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "messageType" "VideoMessageType" NOT NULL DEFAULT 'TEXT',
    "fileUrl" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "fileType" TEXT,
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "replyToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_chat_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "video_chat_messages_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "video_consultations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "video_chat_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "video_chat_messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "video_chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "video_consultation_notes" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "noteType" "VideoNoteType" NOT NULL DEFAULT 'GENERAL',
    "title" TEXT,
    "content" TEXT NOT NULL,
    "prescription" JSONB,
    "symptoms" JSONB,
    "treatmentPlan" JSONB,
    "isAutoSaved" BOOLEAN NOT NULL DEFAULT false,
    "savedToEHR" BOOLEAN NOT NULL DEFAULT false,
    "ehrRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_consultation_notes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "video_consultation_notes_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "video_consultations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "video_consultation_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "video_transcriptions" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "confidence" DOUBLE PRECISION,
    "speakerId" TEXT,
    "startTime" INTEGER,
    "endTime" INTEGER,
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,
    "savedToEHR" BOOLEAN NOT NULL DEFAULT false,
    "ehrRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_transcriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "video_transcriptions_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "video_consultations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "waiting_room_entries" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "WaitingRoomStatus" NOT NULL DEFAULT 'WAITING',
    "position" INTEGER NOT NULL,
    "estimatedWaitTime" INTEGER,
    "admittedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waiting_room_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "waiting_room_entries_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "video_consultations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "waiting_room_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "video_annotations_consultationId_idx" ON "video_annotations"("consultationId");
CREATE INDEX IF NOT EXISTS "video_annotations_userId_idx" ON "video_annotations"("userId");
CREATE INDEX IF NOT EXISTS "video_annotations_createdAt_idx" ON "video_annotations"("createdAt");

CREATE INDEX IF NOT EXISTS "video_chat_messages_consultationId_idx" ON "video_chat_messages"("consultationId");
CREATE INDEX IF NOT EXISTS "video_chat_messages_userId_idx" ON "video_chat_messages"("userId");
CREATE INDEX IF NOT EXISTS "video_chat_messages_createdAt_idx" ON "video_chat_messages"("createdAt");
CREATE INDEX IF NOT EXISTS "video_chat_messages_replyToId_idx" ON "video_chat_messages"("replyToId");

CREATE INDEX IF NOT EXISTS "video_consultation_notes_consultationId_idx" ON "video_consultation_notes"("consultationId");
CREATE INDEX IF NOT EXISTS "video_consultation_notes_userId_idx" ON "video_consultation_notes"("userId");
CREATE INDEX IF NOT EXISTS "video_consultation_notes_noteType_idx" ON "video_consultation_notes"("noteType");
CREATE INDEX IF NOT EXISTS "video_consultation_notes_savedToEHR_idx" ON "video_consultation_notes"("savedToEHR");

CREATE INDEX IF NOT EXISTS "video_transcriptions_consultationId_idx" ON "video_transcriptions"("consultationId");
CREATE INDEX IF NOT EXISTS "video_transcriptions_language_idx" ON "video_transcriptions"("language");
CREATE INDEX IF NOT EXISTS "video_transcriptions_isProcessed_idx" ON "video_transcriptions"("isProcessed");
CREATE INDEX IF NOT EXISTS "video_transcriptions_savedToEHR_idx" ON "video_transcriptions"("savedToEHR");

CREATE INDEX IF NOT EXISTS "waiting_room_entries_consultationId_idx" ON "waiting_room_entries"("consultationId");
CREATE INDEX IF NOT EXISTS "waiting_room_entries_userId_idx" ON "waiting_room_entries"("userId");
CREATE INDEX IF NOT EXISTS "waiting_room_entries_status_idx" ON "waiting_room_entries"("status");
CREATE INDEX IF NOT EXISTS "waiting_room_entries_position_idx" ON "waiting_room_entries"("position");
