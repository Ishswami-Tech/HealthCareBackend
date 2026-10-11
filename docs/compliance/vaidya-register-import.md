# Importing the Vaidya Manager patient register

One-off, resumable import of the clinic's patient register export (CSV) into the Doctor APP.
Code: `src/scripts/vaidya-register-import/`. The importer never prints names, numbers or diagnoses:
output is counts only.

## What an imported patient is

An **unclaimed record**: it has no password, no login phone and no login email, so nobody can sign
in to it, and **no consent row is created** (consent nobody gave is not invented; these patients
show as "consent pending" until given the notice).

| Register column | Goes to |
|---|---|
| UHID No (`26/4116`, 18-digit numbers) | `patient_identifiers`, system `LEGACY_REGISTRATION`. The patient gets a real UHID (system-issued, check digit); the old number stays searchable. |
| OPD No + Case Date | one `patient_visits` row per register row: `opdNumber` = `VM-<register OPD no>` (suffixed with the register number if two patients share one), `registrationDate` = case date at 00:00 India time. |
| Patient Name, Gender, Age, DOB, Address, City, State, Country | `users` (role PATIENT, `primaryClinicId` = the clinic) + `Patient`. Values are kept as recorded: unusable ones (age 5200, a future DOB, a 5-digit "mobile") become empty and are counted in the report, nothing is guessed. |
| Mobile, Email | `patient_contact_points` (E.164 `+91...`). **Not** `users.phone` / `users.email`, which are login identities: a mobile number is often shared by a family and may now belong to someone else. Linking a number to a login needs the patient to verify it. |
| Ayurved Diagnosis | `ayurvedic_diagnoses`, status `HISTORICAL`, with the note that no clinical assessment was recorded. |
| Modern Diagnosis / "Morden System" | `patient_visits.knownCaseOf` (encrypted). The second column is added only when it differs from the first. |
| Reference | not imported (referral source: 9% filled, not part of the case record). |

A register patient who already exists in the app under the same name and mobile number (exactly one
match) is **linked** instead of duplicated: they get the legacy identifier, a UHID and the visits.

## Safety properties

- **Dry run by default.** Nothing is written without `--execute`.
- **All or nothing per batch.** One transaction per batch (default 200 patients).
- **Resumable and idempotent.** Patients are recognised by their legacy number and visits by their
  `VM-` number, so a re-run skips what exists and adds only what is missing (tested).
- **No side effects.** Plain SQL: no events, no notifications, no queue jobs. It does not boot the
  Nest application, so it cannot start a second set of workers or scheduled jobs.
- **Clinical text is never stored unencrypted.** With diagnoses in the file and no
  `FIELD_ENCRYPTION_KEY`, the run refuses to start; `--skip-clinical-text` imports everything else
  first and a later run (once the key is set) adds the diagnoses.
- **UHIDs** are reserved as a contiguous range with one atomic statement per batch, continuing
  after the highest UHID the clinic already has.
- One `PHI_CREATE` audit row per batch (`PATIENT_IMPORT`), append-only.

## Procedure

1. **Backup.** Trigger a database backup and note its id.
2. Copy the file into the API container (gzip + base64 in chunks through the container shell).
3. **Dry run** and read the report:
   `node dist/scripts/vaidya-register-import/import-vaidya-register.js --file /tmp/register.csv --clinic-id <id> --actor-user-id <id> --report /tmp/dry.json`
4. **Small batch:** add `--execute --limit-patients 50`, then verify in the database and through the
   API (counts, no login identity, UHIDs valid, no consent rows, a patient's case sheet opens).
5. **Everything:** `--execute` (resumable: if interrupted, run the same command again).
6. Verify again (the importer prints `verification`: patients, UHIDs, visits, users without login
   identity, consent rows for imported patients = 0, patients without a UHID = 0).
7. Remove the CSV from the container and the server.

## Data quality in the 2016-2026 export (43,498 rows)

43,497 patients and 43,498 visits (one patient has two). 575 visit numbers are reused by different
patients in the source and are suffixed to stay unique. Counted and left empty rather than guessed:
397 unusable mobile numbers, 54 implausible ages, 2 invalid dates of birth, 1 missing visit number.
483 country values normalised from `India (+91)` to `India`. 21,841 patients have a usable mobile
and 1,213 mobile numbers are shared by more than one patient.
