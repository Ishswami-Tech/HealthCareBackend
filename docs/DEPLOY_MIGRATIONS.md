# Deploy-time database migrations (runbook)

Audit item P0-3. Before this change the Coolify deploy path never ran
`prisma migrate deploy`, so new migrations never reached production.

## How it works now

| Piece                                                                          | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/deploy-migrate.js` (in the image at `/app/scripts/deploy-migrate.js`) | 1. `prisma migrate status`. Fails (non-zero exit) on a **failed** migration (P3009), **history drift** (migrations recorded in the DB but missing on disk, or diverged history), or an **unmanaged** schema (P3005). 2. `prisma migrate deploy`. Nothing is auto-resolved. Never prints `DATABASE_URL`. `--status-only` runs step 1 only.                                                                                                                               |
| `devops/scripts/docker-infra/coolify-deploy.sh`                                | Before it asks Coolify to start the new release, it runs the script in a one-shot container from the **new** image. The container shares the network namespace of the running api container (`--network container:api-<uuid>`), so the DB host resolves exactly as it does for the app. `DATABASE_URL` is read on the VPS from the Coolify service `.env` (or the app env file) and passed through a 0600 temp env file. It is never put on a command line or in a log. |
| `.github/workflows/ci.yml` (`deploy` job)                                      | Passes `RUN_DB_MIGRATIONS` from the GitHub **environment** variable (`production` / `preprod`). The `pre-deployment-backup` job always runs before `deploy`, so a backup exists before any migration.                                                                                                                                                                                                                                                                   |
| Docker entrypoint (optional)                                                   | When `RUN_MIGRATIONS=true` on an **api** container, the entrypoint runs the same script before `node dist/main.js` and refuses to start if it fails. The worker never migrates. Off by default; prefer the CI path.                                                                                                                                                                                                                                                     |

`RUN_DB_MIGRATIONS` values (set per GitHub environment, under Settings >
Environments > Variables):

- `status` (default when unset): read-only pre-check. Prints pending migrations
  and drift in the deploy log and **never blocks** the deploy. Pending
  migrations are **not** applied.
- `true`: pre-check, then `migrate deploy`. Any failure stops the deploy before
  the new release starts. The old release keeps serving.
- `false`: skip completely.

Concurrency: `prisma migrate deploy` holds the Postgres advisory lock `72707369`
for the whole run. Two runs (two replicas with `RUN_MIGRATIONS=true`, or CI plus
an entrypoint) cannot apply the same migration twice. The second run waits for
the lock and then finds nothing pending.

Timeouts: the app's `statement_timeout=15s` and `lock_timeout=5s` are set per
session in the PrismaService pool. They are not in `DATABASE_URL`, so migrations
are not cut off by them. Long DDL on big tables still holds locks. Write such
migrations as `CREATE INDEX CONCURRENTLY` (in their own migration file) and
schedule them off-peak.

## Before the first `RUN_DB_MIGRATIONS=true` on production (do this once, on a COPY)

The local migration history is known to be out of sync: 36 rows in
`_prisma_migrations` against 60 migration directories on disk. Several
"unapplied" objects (for example `check_in_attempts`) already exist, so the
schema was pushed or applied by hand. Assume production may look the same.
Several older migrations are not idempotent (for example `20260311060000`,
`20260508130000`, `20260623000000`, `20260923180000`). They will fail if their
objects already exist.

1. **Take a fresh dump** of production (the CI `backup.sh pre-deployment`
   output, or a manual `pg_dump -Fc`).
2. **Restore it into a scratch database** on a non-production host. Never point
   these commands at the production database.
   ```bash
   createdb -h <scratch-host> -U <admin> userdb_migrate_check
   pg_restore -h <scratch-host> -U <admin> -d userdb_migrate_check --no-owner <dump>.dump
   ```
3. **Run the pre-check against the copy** with the release image:
   ```bash
   docker run --rm --entrypoint node \
     -e DATABASE_URL='postgresql://<user>:<pass>@<scratch-host>:5432/userdb_migrate_check?schema=public' \
     ghcr.io/ishswami-tech/healthcarebackend/healthcare-api:<tag> \
     /app/scripts/deploy-migrate.js --status-only
   ```
   Exit code 0 lists the pending migrations. Exit codes 2, 3 and 4 mean failed
   migration, drift and unmanaged schema; the reason is printed.
4. **Reconcile.** For every pending migration whose objects already exist on the
   copy, check that the objects match the migration SQL (tables, columns,
   indexes, enums), then mark it as applied **on the copy**:
   ```bash
   npx prisma migrate resolve --applied <migration_name> \
     --schema src/libs/infrastructure/database/prisma/schema.prisma \
     --config src/libs/infrastructure/database/prisma/prisma.config.js
   ```
   For a migration recorded as failed, use `--rolled-back` (after you have
   undone any partial effect) or `--applied` (if it really completed). If
   migrations in the DB are missing on disk, find out where they came from
   before going further. Do not delete rows from `_prisma_migrations` by hand.
5. **Apply on the copy** (no `--status-only`) and run the app against it.
   Smoke-test login, OTP, booking, check-in, prescriptions and billing.
6. **Repeat steps 4-5 on production**, in a maintenance window, right after a
   fresh backup. Use exactly the `resolve` commands that worked on the copy.
   Production commands are run by a human, not by CI.
7. Then set `RUN_DB_MIGRATIONS=true` on the `production` GitHub environment. Do
   the same on `preprod` first and watch one preprod deploy.

## When a deploy fails in the migration step

- The new release was **not** started; the old one is still serving.
- Read the `[migrate]` lines in the GitHub Actions deploy log.
  - `failed` / `drift` / `unmanaged`: follow steps 2-6 above on a copy.
  - `migrate deploy failed`: the failing migration is now recorded as failed.
    Inspect it on a copy restored from the **pre-deployment backup** of this
    run, fix the SQL in a **new** migration (never edit an applied one),
    `migrate resolve --rolled-back <name>` on prod if nothing was applied, then
    redeploy.
- Restore the pre-deployment backup only if a migration half-applied and cannot
  be completed. This loses writes made since the backup.

## Local / developer notes

- `node scripts/deploy-migrate.js --status-only` works locally with
  `DATABASE_URL` set.
- Never run `prisma migrate reset` or `db push --accept-data-loss` against a
  shared database.
