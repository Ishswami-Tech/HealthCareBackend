-- Optimize logs table for better query performance
-- This script adds indexes to improve the slow log queries

-- Add index on timestamp for time-based queries
CREATE INDEX IF NOT EXISTS "logs_timestamp_idx" ON "logs" ("timestamp" DESC);

-- Add index on type for filtering by log type
CREATE INDEX IF NOT EXISTS "logs_type_idx" ON "logs" ("type");

-- Add index on level for filtering by log level
CREATE INDEX IF NOT EXISTS "logs_level_idx" ON "logs" ("level");

-- Add composite index for the most common query pattern (timestamp, type, level)
CREATE INDEX IF NOT EXISTS "logs_timestamp_type_level_idx" ON "logs" ("timestamp" DESC, "type", "level");

-- Add partial index for recent logs (last 7 days) to improve performance
CREATE INDEX IF NOT EXISTS "logs_recent_idx" ON "logs" ("timestamp" DESC) 
WHERE "timestamp" > NOW() - INTERVAL '7 days';

-- Analyze the table to update statistics
ANALYZE "logs"; 