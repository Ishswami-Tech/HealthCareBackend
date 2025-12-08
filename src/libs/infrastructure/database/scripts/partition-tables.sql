/**
 * Database Partitioning Migration
 * =================================
 * Partitions high-volume tables for 10M+ user scalability
 * 
 * Tables partitioned:
 * - appointments (by date)
 * - check_ins (by checkedInAt)
 * - audit_logs (by timestamp)
 * - notifications (by createdAt)
 * 
 * Partitioning Strategy: Range partitioning by month
 * 
 * Usage:
 *   psql -U postgres -d healthcare_db -f partition-tables.sql
 * 
 * @module partition-tables
 * @description PostgreSQL table partitioning for scalability
 * @see https://www.postgresql.org/docs/current/ddl-partitioning.html - PostgreSQL Partitioning Documentation
 */

-- ============================================
-- APPOINTMENT TABLE PARTITIONING
-- ============================================

-- Step 1: Create new partitioned table structure
CREATE TABLE IF NOT EXISTS appointments_partitioned (
  LIKE appointments INCLUDING ALL
) PARTITION BY RANGE (date);

-- Step 2: Create partitions for current and next 12 months
-- Current month
CREATE TABLE IF NOT EXISTS appointments_2025_12 PARTITION OF appointments_partitioned
  FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

-- Next 12 months
CREATE TABLE IF NOT EXISTS appointments_2026_01 PARTITION OF appointments_partitioned
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE IF NOT EXISTS appointments_2026_02 PARTITION OF appointments_partitioned
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE IF NOT EXISTS appointments_2026_03 PARTITION OF appointments_partitioned
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS appointments_2026_04 PARTITION OF appointments_partitioned
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE IF NOT EXISTS appointments_2026_05 PARTITION OF appointments_partitioned
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS appointments_2026_06 PARTITION OF appointments_partitioned
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS appointments_2026_07 PARTITION OF appointments_partitioned
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS appointments_2026_08 PARTITION OF appointments_partitioned
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS appointments_2026_09 PARTITION OF appointments_partitioned
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS appointments_2026_10 PARTITION OF appointments_partitioned
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS appointments_2026_11 PARTITION OF appointments_partitioned
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS appointments_2026_12 PARTITION OF appointments_partitioned
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- Default partition for older data
CREATE TABLE IF NOT EXISTS appointments_default PARTITION OF appointments_partitioned
  DEFAULT;

-- Step 3: Migrate existing data (run after creating partitions)
-- INSERT INTO appointments_partitioned SELECT * FROM appointments;

-- Step 4: Rename tables (run after data migration is verified)
-- ALTER TABLE appointments RENAME TO appointments_old;
-- ALTER TABLE appointments_partitioned RENAME TO appointments;

-- ============================================
-- CHECK_IN TABLE PARTITIONING
-- ============================================

CREATE TABLE IF NOT EXISTS check_ins_partitioned (
  LIKE "CheckIn" INCLUDING ALL
) PARTITION BY RANGE ("checkedInAt");

-- Create partitions for current and next 12 months
CREATE TABLE IF NOT EXISTS check_ins_2025_12 PARTITION OF check_ins_partitioned
  FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

CREATE TABLE IF NOT EXISTS check_ins_2026_01 PARTITION OF check_ins_partitioned
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE IF NOT EXISTS check_ins_2026_02 PARTITION OF check_ins_partitioned
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE IF NOT EXISTS check_ins_2026_03 PARTITION OF check_ins_partitioned
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS check_ins_2026_04 PARTITION OF check_ins_partitioned
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE IF NOT EXISTS check_ins_2026_05 PARTITION OF check_ins_partitioned
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS check_ins_2026_06 PARTITION OF check_ins_partitioned
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS check_ins_2026_07 PARTITION OF check_ins_partitioned
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS check_ins_2026_08 PARTITION OF check_ins_partitioned
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS check_ins_2026_09 PARTITION OF check_ins_partitioned
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS check_ins_2026_10 PARTITION OF check_ins_partitioned
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS check_ins_2026_11 PARTITION OF check_ins_partitioned
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS check_ins_2026_12 PARTITION OF check_ins_partitioned
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

CREATE TABLE IF NOT EXISTS check_ins_default PARTITION OF check_ins_partitioned
  DEFAULT;

-- ============================================
-- AUDIT_LOG TABLE PARTITIONING
-- ============================================

CREATE TABLE IF NOT EXISTS audit_logs_partitioned (
  LIKE "AuditLog" INCLUDING ALL
) PARTITION BY RANGE (timestamp);

-- Create partitions for current and next 12 months
CREATE TABLE IF NOT EXISTS audit_logs_2025_12 PARTITION OF audit_logs_partitioned
  FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

CREATE TABLE IF NOT EXISTS audit_logs_2026_01 PARTITION OF audit_logs_partitioned
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_02 PARTITION OF audit_logs_partitioned
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_03 PARTITION OF audit_logs_partitioned
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_04 PARTITION OF audit_logs_partitioned
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_05 PARTITION OF audit_logs_partitioned
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_06 PARTITION OF audit_logs_partitioned
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_07 PARTITION OF audit_logs_partitioned
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_08 PARTITION OF audit_logs_partitioned
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_09 PARTITION OF audit_logs_partitioned
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_10 PARTITION OF audit_logs_partitioned
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_11 PARTITION OF audit_logs_partitioned
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_12 PARTITION OF audit_logs_partitioned
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

CREATE TABLE IF NOT EXISTS audit_logs_default PARTITION OF audit_logs_partitioned
  DEFAULT;

-- ============================================
-- NOTIFICATION TABLE PARTITIONING
-- ============================================

CREATE TABLE IF NOT EXISTS notifications_partitioned (
  LIKE "Notification" INCLUDING ALL
) PARTITION BY RANGE ("createdAt");

-- Create partitions for current and next 12 months
CREATE TABLE IF NOT EXISTS notifications_2025_12 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

CREATE TABLE IF NOT EXISTS notifications_2026_01 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE IF NOT EXISTS notifications_2026_02 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE IF NOT EXISTS notifications_2026_03 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS notifications_2026_04 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE IF NOT EXISTS notifications_2026_05 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS notifications_2026_06 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS notifications_2026_07 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS notifications_2026_08 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS notifications_2026_09 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS notifications_2026_10 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS notifications_2026_11 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS notifications_2026_12 PARTITION OF notifications_partitioned
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

CREATE TABLE IF NOT EXISTS notifications_default PARTITION OF notifications_partitioned
  DEFAULT;

-- ============================================
-- AUTOMATIC PARTITION CREATION FUNCTION
-- ============================================

-- Function to automatically create partitions for the next month
CREATE OR REPLACE FUNCTION create_monthly_partition(
  table_name TEXT,
  partition_column TEXT,
  partition_date DATE
) RETURNS VOID AS $$
DECLARE
  partition_name TEXT;
  start_date DATE;
  end_date DATE;
BEGIN
  -- Calculate partition boundaries
  start_date := DATE_TRUNC('month', partition_date);
  end_date := start_date + INTERVAL '1 month';
  
  -- Generate partition name (e.g., appointments_2026_01)
  partition_name := table_name || '_' || TO_CHAR(start_date, 'YYYY_MM');
  
  -- Create partition if it doesn't exist
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
    partition_name,
    table_name || '_partitioned',
    start_date,
    end_date
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PARTITION MAINTENANCE FUNCTION
-- ============================================

-- Function to create partitions for next N months
CREATE OR REPLACE FUNCTION create_future_partitions(
  table_name TEXT,
  partition_column TEXT,
  months_ahead INT DEFAULT 12
) RETURNS VOID AS $$
DECLARE
  i INT;
  target_date DATE;
BEGIN
  FOR i IN 0..months_ahead LOOP
    target_date := DATE_TRUNC('month', CURRENT_DATE + (i || ' months')::INTERVAL);
    PERFORM create_monthly_partition(table_name, partition_column, target_date);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Create initial future partitions
SELECT create_future_partitions('appointments', 'date', 12);
SELECT create_future_partitions('check_ins', 'checkedInAt', 12);
SELECT create_future_partitions('audit_logs', 'timestamp', 12);
SELECT create_future_partitions('notifications', 'createdAt', 12);

-- ============================================
-- INDEXES ON PARTITIONS
-- ============================================

-- Note: Indexes on parent table are automatically inherited by partitions
-- Additional partition-specific indexes can be created here if needed

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check partition status
-- SELECT schemaname, tablename, tableowner 
-- FROM pg_tables 
-- WHERE tablename LIKE '%_partitioned' OR tablename LIKE '%_2026_%';

-- Check partition sizes
-- SELECT 
--   schemaname,
--   tablename,
--   pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
-- FROM pg_tables
-- WHERE tablename LIKE 'appointments_%' OR tablename LIKE 'check_ins_%'
-- ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
