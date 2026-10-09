# EHR compliance foundations

What the backend does today for health-data standards and data protection, what it does not, and how
to operate it. This is an engineering status document, not legal advice: have the clinic's
compliance adviser review the open items before relying on it.

## Status

| Area | Status | Where |
|---|---|---|
| PHI access audit | Implemented. Every read of a visit, case sheet, vitals, exam findings, consent, identifiers and every FHIR read writes a structured `AuditLog` row (`action` = `PHI_VIEW` / `PHI_CREATE` / `PHI_EXPORT`, `resourceType`, `resourceId`, `metadata.patientId`, IP, user agent) plus the existing `logPhiAccess` log line. The two sinks are written independently. A whole-record FHIR export (`$everything`) is audited **first** and fails closed: no audit row, no export. PHI rows are append-only at the database (trigger). | `src/services/compliance/services/phi-audit.service.ts` |
| Patient consent (DPDP Act 2023) | Implemented as an append-only ledger (a database trigger refuses UPDATE and DELETE). A staff member recording a grant for `RESEARCH`, `ABDM_LINKING` or `DATA_SHARING_WITH_PROVIDERS` on a patient's behalf must supply evidence (e.g. a signed-form reference). No UI yet and no consent text: notice wording and versions must come from the clinic's counsel. | `src/services/compliance/`, table `patient_consents` |
| Patient identifiers | UHID (system-issued, check digit), ABHA number / address (format validated), legacy numbers from earlier registers. | `patient_identifiers`, `uhid-allocator.service.ts` |
| Contact points | Phone/email on file, separate from the login phone. | `patient_contact_points` |
| Field encryption | Implemented, **off until `FIELD_ENCRYPTION_KEY` is set**. Covers the free-text clinical fields of a visit. | `field-encryption.service.ts`, `field-crypto.util.ts` |
| FHIR R4 | Read-only: Patient, Encounter, Observation, Condition, AllergyIntolerance, MedicationStatement, Bundle, CapabilityStatement. | `src/services/fhir/` |
| Medical coding | Structure only. Diagnoses can carry FHIR-style `codings`; the ICD-10 / ICD-11 TM2 / NAMASTE / SNOMED CT tables are licensed datasets and are not bundled. Case-sheet options have stable codes in the clinic's own code system. | `ayurvedic_diagnoses.codings`, `case-sheet-codes.ts` |
| Doctor registration number | `Doctor.licenseNumber` existed; it is now printed on the prescription PDF. | `prescription-pdf.util.ts` |
| ABDM / ABHA integration | **Not implemented.** Only the ABHA fields exist. Joining ABDM needs an HIP/HIU registration and credentials issued by NHA. | - |
| Tenant isolation | Application layer only. See `adr-tenant-isolation.md`. | - |
| Retention / erasure / breach | Runbooks only. See `runbooks.md`. | - |

## Hosting and data residency (open item)

Production runs on one Contabo VPS. Its public IP geolocates to Lauterbourg, France (Contabo GmbH).
IP geolocation is approximate, but the server is not in India. Confirm with the clinic's adviser
whether storing identifiable patient data there is acceptable under the DPDP Act cross-border
rules and, if ABDM is pursued, under ABDM's data-localisation expectations. Moving to an Indian
region is an infrastructure decision, not a code change.

## Field encryption

- Algorithm: AES-256-GCM, per-value key from HKDF-SHA256, 96-bit random IV, and the value is bound
  to its row and column (`patient_visits.<field>:<visitId>`), so ciphertext cannot be swapped.
- Envelope: `enc:v2:<base64>`. A value without the prefix is legacy plaintext and reads unchanged.
- Key: 32 random bytes (`openssl rand -base64 32`), env `FIELD_ENCRYPTION_KEY`. Passphrases,
  lenient look-alikes and keys made of one repeated byte are rejected at startup.
  `FIELD_ENCRYPTION_REQUIRED=true` refuses to boot without a key; the flag is parsed strictly
  (`true/1/yes/on`, `false/0/no/off`), and any other value stops startup instead of meaning "off".
  With no key in production an ERROR is logged at every start.
- Rotation: the envelope carries a key id. Put the new key in `FIELD_ENCRYPTION_KEY` and the old
  one(s) in `FIELD_ENCRYPTION_KEY_PREVIOUS` (comma separated); old values keep opening, new writes
  use the new key. Re-encrypt old values, then drop the old key.
- A field that cannot be opened (no matching key, altered, moved) shows
  `[protected field could not be read]` and is logged at ERROR; it does not fail the whole list.
  Free text that itself starts with `enc:v2:` is refused (HTTP 400) because it would be mistaken
  for ciphertext.
- **Order of rollout:** provision the key in the secret manager and back it up *separately from the
  database*, deploy, then set `FIELD_ENCRYPTION_REQUIRED=true`. Set the key **before** importing
  historical patient records so they are encrypted at rest from the first write.
- Losing the key makes the encrypted fields unrecoverable. There is no key rotation yet: rotating
  requires decrypting with the old key and re-encrypting (write a one-off script; the envelope has
  no key id).
- Not encrypted, deliberately: names, phone numbers and other columns that are searched or used as
  login identities, selectable values (`nidra`, `habits`) and identifiers (including ABHA
  numbers and addresses, which are stored in plaintext in `patient_identifiers`). Encrypting those needs a
  blind-index design (`hashField` exists for that) and is a separate piece of work. Disk and TLS
  encryption are infrastructure settings and are not visible from this repository.

## Permissions

New RBAC resources: `consent` (`read`, `create`) and `patient-identifiers` (`read`, `update`). Staff
roles (clinic admin, doctor, assistant doctor, nurse, receptionist) hold both. PATIENT holds
`consent:read`, `consent:create` and `patient-identifiers:read`; the services then check that the
record is the caller's own. The FHIR routes use `ehr:read`, which PATIENT already had.

## UHID

`<CLINIC>-<8-digit sequence><Luhn check digit>`, e.g. `ISH-000000018`. Opaque, no year or personal
data, never reused, unique per clinic. Issued automatically at a patient's first visit registration
in a clinic (`POST /compliance/patient-identifiers/uhid` issues one on demand). Staff cannot type a
UHID in, and a UHID is created once and never replaced (create-only: a concurrent registration
cannot overwrite one that was already issued). A mistyped number fails its check digit before it reaches a lookup. Numbers from an earlier
system are stored as `LEGACY_REGISTRATION` and are searchable through
`GET /compliance/patient-identifiers/lookup`.

## Consent ledger

One row per grant or withdrawal, never updated or deleted. The newest row per
`(patient, clinic, purpose)` is the current state. `version` + a unique index make two concurrent
writers collide (HTTP 409) instead of both succeeding. Staff may record consent on a patient's
behalf (`capturedVia = STAFF`); a patient records their own (`SELF`). **Records imported from an
earlier system get no consent row**: consent nobody gave is not invented. They are reported as
"consent pending" until the patient is given the notice.

## Reading the audit trail

```sql
-- Who viewed this visit's case sheet, newest first
SELECT "timestamp", "userId", action, "resourceType", metadata->>'userRole' AS role
FROM "AuditLog"
WHERE "resourceId" = '<visit id>' AND action LIKE 'PHI\_%'
ORDER BY "timestamp" DESC;

-- Everything one user accessed in the last 24 hours
SELECT "timestamp", action, "resourceType", "resourceId", metadata->>'patientId' AS patient
FROM "AuditLog"
WHERE "userId" = '<user id>' AND action LIKE 'PHI\_%' AND "timestamp" > now() - interval '24 hours'
ORDER BY "timestamp";
```

The same table also holds the general application log (`CACHE`, `SYSTEM`, `AUTH`, ...), which is
why PHI rows are identified by the `PHI_` action prefix. Rows with that prefix cannot be updated or
deleted (trigger `auditlog_phi_append_only`); other rows stay deletable. A bulk delete of the whole
table therefore fails while PHI rows exist, which is intended. `auditRetentionDays` is configured
as 2555 (7 years); nothing in this repository currently purges `AuditLog`, so retention is "keep".
A superuser or the table owner can still drop the trigger: restrict the database role the API
connects with so it cannot.

## FHIR

See `src/services/fhir/README.md`. Read-only; ABDM profiles and bundles are not implemented.
Identifier system URIs are in `fhir.constants.ts`; the ABHA ones must be checked against the current
ABDM FHIR profile before ABDM go-live.
