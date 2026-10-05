-- Align the database enum with the existing Prisma schema and document queries.
-- Adding a value preserves all existing health records and is safe to rerun.
ALTER TYPE "HealthRecordType" ADD VALUE IF NOT EXISTS 'GENERAL_DOCUMENT';
