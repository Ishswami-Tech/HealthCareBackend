-- EHR compliance foundations. Idempotent (IF NOT EXISTS) and additive only, so it can be applied
-- before the deploy that uses it.

-- Patient business identifiers (UHID, ABHA number / address, legacy numbers), unique per clinic.
CREATE TABLE IF NOT EXISTS "patient_identifiers" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "patient_identifiers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "patient_identifiers_clinicId_system_value_key"
    ON "patient_identifiers"("clinicId", "system", "value");
CREATE UNIQUE INDEX IF NOT EXISTS "patient_identifiers_patientId_clinicId_system_key"
    ON "patient_identifiers"("patientId", "clinicId", "system");
CREATE INDEX IF NOT EXISTS "patient_identifiers_patientId_idx" ON "patient_identifiers"("patientId");
CREATE INDEX IF NOT EXISTS "patient_identifiers_clinicId_idx" ON "patient_identifiers"("clinicId");

-- Per-clinic UHID counter, allocated by atomic upsert-increment.
CREATE TABLE IF NOT EXISTS "uhid_sequences" (
    "clinicId" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "uhid_sequences_pkey" PRIMARY KEY ("clinicId")
);

-- Contact points on file (not login identities). A number may be shared by several patients.
CREATE TABLE IF NOT EXISTS "patient_contact_points" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "use" TEXT NOT NULL DEFAULT 'mobile',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "patient_contact_points_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "patient_contact_points_patientId_clinicId_system_value_key"
    ON "patient_contact_points"("patientId", "clinicId", "system", "value");
CREATE INDEX IF NOT EXISTS "patient_contact_points_clinicId_system_value_idx"
    ON "patient_contact_points"("clinicId", "system", "value");
CREATE INDEX IF NOT EXISTS "patient_contact_points_patientId_idx" ON "patient_contact_points"("patientId");

-- Append-only consent ledger (DPDP Act 2023).
CREATE TABLE IF NOT EXISTS "patient_consents" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "language" TEXT,
    "status" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "capturedVia" TEXT NOT NULL,
    "evidence" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "patient_consents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "patient_consents_status_check" CHECK ("status" IN ('GRANTED', 'WITHDRAWN'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "patient_consents_patientId_clinicId_purpose_version_key"
    ON "patient_consents"("patientId", "clinicId", "purpose", "version");
CREATE INDEX IF NOT EXISTS "patient_consents_patientId_clinicId_purpose_recordedAt_idx"
    ON "patient_consents"("patientId", "clinicId", "purpose", "recordedAt");
CREATE INDEX IF NOT EXISTS "patient_consents_clinicId_idx" ON "patient_consents"("clinicId");

-- Standard codes (FHIR-style codings) for an Ayurvedic diagnosis.
ALTER TABLE "ayurvedic_diagnoses" ADD COLUMN IF NOT EXISTS "codings" JSONB;

-- Append-only guarantees, enforced by the database and not by convention.
-- The consent ledger can never be changed or deleted; PHI access rows in "AuditLog" (action
-- 'PHI_...') likewise. Other AuditLog rows (the general application log) stay deletable.
CREATE OR REPLACE FUNCTION "forbid_ledger_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: rows cannot be updated or deleted', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "patient_consents_append_only" ON "patient_consents";
CREATE TRIGGER "patient_consents_append_only"
  BEFORE UPDATE OR DELETE ON "patient_consents"
  FOR EACH ROW EXECUTE FUNCTION "forbid_ledger_change"();

CREATE OR REPLACE FUNCTION "forbid_phi_audit_change"() RETURNS trigger AS $$
BEGIN
  IF OLD."action" LIKE 'PHI\_%' THEN
    RAISE EXCEPTION 'PHI audit rows are append-only: rows cannot be updated or deleted'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "auditlog_phi_append_only" ON "AuditLog";
CREATE TRIGGER "auditlog_phi_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "forbid_phi_audit_change"();
