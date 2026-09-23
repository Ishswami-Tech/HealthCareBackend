-- Simplify InvoiceStatus from 6 values to 3: PENDING, PAID, VOID.
-- Mapping applied to existing rows:
--   DRAFT, OPEN, OVERDUE -> PENDING (still awaiting payment / open)
--   UNCOLLECTIBLE        -> VOID    (already written off, no longer expecting payment)
--   PAID, VOID           -> unchanged
--
-- Postgres does not support removing enum values in place, so this recreates
-- the type: create the new 3-value type, migrate the column to it with an
-- explicit backfill mapping, then drop the old type and rename the new one
-- into its place.

-- 1. Create the new, narrower enum type.
CREATE TYPE "InvoiceStatus_new" AS ENUM ('PENDING', 'PAID', 'VOID');

-- 2. Migrate the Invoice.status column to the new type with a backfill mapping.
ALTER TABLE "Invoice" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Invoice"
  ALTER COLUMN "status" TYPE "InvoiceStatus_new"
  USING (
    CASE "status"::text
      WHEN 'DRAFT' THEN 'PENDING'
      WHEN 'OPEN' THEN 'PENDING'
      WHEN 'OVERDUE' THEN 'PENDING'
      WHEN 'UNCOLLECTIBLE' THEN 'VOID'
      WHEN 'PAID' THEN 'PAID'
      WHEN 'VOID' THEN 'VOID'
    END
  )::"InvoiceStatus_new";

ALTER TABLE "Invoice" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- 3. Drop the old enum type and rename the new one into its place.
DROP TYPE "InvoiceStatus";
ALTER TYPE "InvoiceStatus_new" RENAME TO "InvoiceStatus";
