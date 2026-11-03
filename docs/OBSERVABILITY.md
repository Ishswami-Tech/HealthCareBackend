# Database observability

PostgreSQL settings for finding slow queries and checking that autovacuum keeps
up.

## Settings

| Setting                              | Value                             | Why                                            |
| ------------------------------------ | --------------------------------- | ---------------------------------------------- |
| `shared_preload_libraries`           | `pg_stat_statements,auto_explain` | per-statement totals; plans of slow statements |
| `pg_stat_statements.track`           | `all`                             | include statements inside functions            |
| `pg_stat_statements.max`             | `10000`                           | distinct statements kept                       |
| `auto_explain.log_min_duration`      | `500ms`                           | log the plan of any statement slower than this |
| `auto_explain.log_nested_statements` | `on`                              | plans of statements inside functions too       |
| `log_min_duration_statement`         | `250ms`                           | log every statement slower than 250 ms         |
| `log_autovacuum_min_duration`        | `0`                               | log every autovacuum / autoanalyze run         |

`shared_preload_libraries` needs a server **restart with the new command line**:
for Docker that means recreating the container
(`docker compose up -d --force-recreate postgres`); a plain `docker restart`
keeps the old command. Then, once per database:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

`log_min_duration_statement` and `log_autovacuum_min_duration` don't need a
restart:

```sql
ALTER SYSTEM SET log_min_duration_statement = '250ms';
ALTER SYSTEM SET log_autovacuum_min_duration = 0;
SELECT pg_reload_conf();
```

## Where they are set

- **Development**: `devops/docker/docker-compose.dev.yml`, `postgres.command`
  (all the flags above). They take effect the next time the container is
  recreated.
- **Production / preprod / Coolify**: these compose files are **not** changed.
  To turn this on, add the same `-c` flags to the `postgres` `command:` in
  `devops/docker/docker-compose.prod.yml` (and the preprod / Coolify
  equivalents), recreate the postgres container in a maintenance window, then
  run `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`. Expect more log
  volume: around 1-3% CPU for pg_stat_statements, and one log line per slow
  statement or autovacuum run.

## Useful queries

```sql
-- Top statements by total time
SELECT calls, round(total_exec_time) AS total_ms, round(mean_exec_time, 1) AS mean_ms,
       rows, left(query, 120) AS query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;

-- Index usage (indexes never scanned are candidates for removal)
SELECT relname, indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC;

-- Dead tuples / last autovacuum on hot tables
SELECT relname, n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables
WHERE relname IN ('Appointment', 'Payment', 'Invoice', 'AuditLog', 'NotificationDeliveryLog',
                  'clinic_audit_events', 'check_in_attempts')
ORDER BY n_dead_tup DESC;

-- Reset the counters after a deploy
SELECT pg_stat_statements_reset();
```

Per-table autovacuum settings, Appointment `fillfactor` and the partial indexes
are created by migration `20261021000000_phase3_hot_filter_indexes`. The dev
container's `prisma db push` drops SQL-only (partial) indexes. Re-apply that
migration file with `psql` after a dev restart when testing them.
