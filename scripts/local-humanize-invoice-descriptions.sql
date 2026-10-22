-- ============================================================================
-- local-humanize-invoice-descriptions.sql   (LOCAL DEV DATABASE ONLY)
--
-- Rewrites old machine-style invoice text into the wording the code now writes
-- (src/services/billing/invoice-description.util.ts):
--   "Payment for VIDEO_CALL appointment"      -> "Video consultation with Dr. X — 22 Oct 2026, 10:30 AM"
--   "Pharmacy bill for prescription <uuid>"   -> "Medicines — Rx #RX-20261022-A1B2C3D4"
--   "Subscription renewal for <plan>"         -> "<plan> — monthly"
-- Only description text / first line-item description change; amounts, status and metadata
-- are untouched. Idempotent: rewritten rows no longer match the old patterns.
-- Treatment labels are not rebuilt here (new invoices carry them when not generic).
--
-- Run:  docker exec -i healthcare-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--         < scripts/local-humanize-invoice-descriptions.sql
-- Never run against preprod / production.
-- ============================================================================
BEGIN;

-- 1. Appointment invoices (metadata.appointmentId -> Appointment -> Doctor -> users).
WITH src AS (
  SELECT
    i.id,
    CASE a.type::text
      WHEN 'VIDEO_CALL' THEN 'Video consultation'
      WHEN 'IN_PERSON' THEN 'In-clinic consultation'
      WHEN 'HOME_VISIT' THEN 'Home visit'
      ELSE 'Consultation'
    END
    || CASE
         WHEN NULLIF(trim(u.name), '') IS NOT NULL
           THEN ' with Dr. ' || regexp_replace(trim(u.name), '^[Dd][Rr]\.?\s+', '')
         ELSE ''
       END
    || ' — ' || to_char((a.date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, 'FMDD Mon YYYY')
    || CASE
         WHEN a.time ~ '^\d{1,2}:\d{2}' THEN ', ' || to_char(a.time::time, 'FMHH12:MI AM')
         ELSE ''
       END AS text
  FROM "Invoice" i
  JOIN "Appointment" a ON a.id = i.metadata ->> 'appointmentId'
  LEFT JOIN "Doctor" d ON d.id = a."doctorId"
  LEFT JOIN users u ON u.id = d."userId"
  WHERE i.description ~* '^Payment for .* appointment'
)
UPDATE "Invoice" i
SET description = src.text,
    "lineItems" = CASE
      WHEN jsonb_typeof(i."lineItems" -> 'items') = 'array'
           AND jsonb_array_length(i."lineItems" -> 'items') > 0
        THEN jsonb_set(i."lineItems", '{items,0,description}', to_jsonb(src.text))
      ELSE i."lineItems"
    END,
    "updatedAt" = now()
FROM src
WHERE i.id = src.id;

-- 2. Pharmacy bills (stored prescriptionNumber, else the same RX-YYYYMMDD-XXXXXXXX the code derives).
UPDATE "Invoice" i
SET description = 'Medicines — Rx #' || COALESCE(
      NULLIF(trim(p."prescriptionNumber"), ''),
      'RX-' || to_char((p.date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, 'YYYYMMDD')
        || '-' || upper(left(replace(p.id, '-', ''), 8))
    ),
    "updatedAt" = now()
FROM "Prescription" p
WHERE p.id = i."prescriptionId"
  AND i.description ~* '^Pharmacy bill for prescription';

-- 3. Plan invoices ("Subscription renewal for X" / "Subscription: X").
WITH src AS (
  SELECT
    i.id,
    bp.name || ' — ' || CASE
      WHEN bp."intervalCount" > 1 THEN 'every ' || bp."intervalCount" || ' ' || CASE bp.interval::text
        WHEN 'DAILY' THEN 'days' WHEN 'WEEKLY' THEN 'weeks' WHEN 'MONTHLY' THEN 'months'
        WHEN 'QUARTERLY' THEN 'quarters' ELSE 'years' END
      ELSE lower(bp.interval::text)
    END AS text
  FROM "Invoice" i
  JOIN "Subscription" s ON s.id = i."subscriptionId"
  JOIN "BillingPlan" bp ON bp.id = s."planId"
  WHERE i.description ~* '^(Subscription renewal for |Subscription: )'
)
UPDATE "Invoice" i
SET description = src.text,
    "lineItems" = CASE
      WHEN jsonb_typeof(i."lineItems" -> 'items') = 'array'
           AND jsonb_array_length(i."lineItems" -> 'items') > 0
        THEN jsonb_set(i."lineItems", '{items,0,description}', to_jsonb(src.text))
      ELSE i."lineItems"
    END,
    "updatedAt" = now()
FROM src
WHERE i.id = src.id;

-- Check: no patient-facing invoice text still carries a uuid.
SELECT count(*) AS descriptions_with_uuid
FROM "Invoice"
WHERE description ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

COMMIT;
