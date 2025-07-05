#!/bin/bash

# Database Performance Monitoring Script
# This script helps identify and monitor slow queries in the healthcare backend

set -e

# Configuration
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-userdb}
DB_USER=${DB_USER:-postgres}
LOG_FILE="/tmp/db_performance_$(date +%Y%m%d_%H%M%S).log"

echo "=== Database Performance Monitor ===" | tee -a "$LOG_FILE"
echo "Started at: $(date)" | tee -a "$LOG_FILE"
echo "Database: $DB_NAME on $DB_HOST:$DB_PORT" | tee -a "$LOG_FILE"
echo "=====================================" | tee -a "$LOG_FILE"

# Function to run SQL query and log results
run_query() {
    local query="$1"
    local description="$2"
    
    echo "--- $description ---" | tee -a "$LOG_FILE"
    echo "Query: $query" | tee -a "$LOG_FILE"
    
    PGPASSWORD=$DB_PASSWORD psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$query" 2>&1 | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
}

# Check if database is accessible
echo "Testing database connection..." | tee -a "$LOG_FILE"
if ! PGPASSWORD=$DB_PASSWORD psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" > /dev/null 2>&1; then
    echo "ERROR: Cannot connect to database. Please check your connection settings." | tee -a "$LOG_FILE"
    exit 1
fi

echo "Database connection successful!" | tee -a "$LOG_FILE"

# 1. Check current active queries
run_query "
SELECT 
    pid,
    usename,
    application_name,
    client_addr,
    state,
    query_start,
    now() - query_start as duration,
    query
FROM pg_stat_activity 
WHERE state = 'active' 
    AND query NOT LIKE '%pg_stat_activity%'
ORDER BY query_start;
" "Current Active Queries"

# 2. Check slow queries (longer than 1 second)
run_query "
SELECT 
    pid,
    usename,
    application_name,
    client_addr,
    state,
    query_start,
    now() - query_start as duration,
    LEFT(query, 100) as query_preview
FROM pg_stat_activity 
WHERE state = 'active' 
    AND now() - query_start > interval '1 second'
    AND query NOT LIKE '%pg_stat_activity%'
ORDER BY query_start;
" "Slow Queries (>1 second)"

# 3. Check table sizes
run_query "
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
    pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY size_bytes DESC;
" "Table Sizes"

# 4. Check index usage
run_query "
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan as index_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes 
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;
" "Index Usage Statistics"

# 5. Check unused indexes
run_query "
SELECT 
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes 
WHERE schemaname = 'public'
    AND idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;
" "Unused Indexes"

# 6. Check table statistics
run_query "
SELECT 
    schemaname,
    tablename,
    n_tup_ins as inserts,
    n_tup_upd as updates,
    n_tup_del as deletes,
    n_live_tup as live_tuples,
    n_dead_tup as dead_tuples,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze
FROM pg_stat_user_tables 
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;
" "Table Statistics"

# 7. Check connection count
run_query "
SELECT 
    state,
    count(*) as connection_count
FROM pg_stat_activity 
GROUP BY state
ORDER BY connection_count DESC;
" "Connection Count by State"

# 8. Check database locks
run_query "
SELECT 
    l.pid,
    l.mode,
    l.granted,
    a.usename,
    a.application_name,
    a.client_addr,
    a.state,
    a.query_start,
    now() - a.query_start as duration,
    LEFT(a.query, 100) as query_preview
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE l.pid <> pg_backend_pid()
ORDER BY a.query_start;
" "Database Locks"

# 9. Check slowest queries from pg_stat_statements (if available)
run_query "
SELECT 
    query,
    calls,
    total_time,
    mean_time,
    rows,
    100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) AS hit_percent
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;
" "Slowest Queries (pg_stat_statements)"

# 10. Check vacuum and analyze status
run_query "
SELECT 
    schemaname,
    tablename,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze,
    CASE 
        WHEN last_vacuum IS NULL AND last_autovacuum IS NULL THEN 'Never vacuumed'
        WHEN last_vacuum > last_autovacuum THEN 'Manual vacuum'
        ELSE 'Auto vacuum'
    END as vacuum_type
FROM pg_stat_user_tables 
WHERE schemaname = 'public'
ORDER BY COALESCE(last_vacuum, last_autovacuum) ASC NULLS FIRST;
" "Vacuum and Analyze Status"

echo "=== Performance Monitor Complete ===" | tee -a "$LOG_FILE"
echo "Log file saved to: $LOG_FILE" | tee -a "$LOG_FILE"
echo "Completed at: $(date)" | tee -a "$LOG_FILE"

# Optional: Send summary via email if configured
if [ ! -z "$ALERT_EMAIL" ]; then
    echo "Sending performance report to $ALERT_EMAIL..."
    mail -s "Database Performance Report - $(date)" "$ALERT_EMAIL" < "$LOG_FILE"
fi

echo "Performance monitoring completed successfully!" 