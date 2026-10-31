-- REG-D1: the Prisma model for "nadi_pariksha_records" was renamed from `nadiPariksha` to
-- `NadiParikshaRecord` so it no longer shares a client handle with the legacy `NadiPariksha`
-- model. Table, columns and indexes are unchanged (`prisma migrate diff` is empty); this
-- migration only records the schema change for the migration-sync gate.
SELECT 1;
