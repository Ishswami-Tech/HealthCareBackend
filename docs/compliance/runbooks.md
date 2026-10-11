# Retention, erasure and breach runbooks

Operational procedures for the clinic's data fiduciary role under India's Digital Personal Data
Protection Act, 2023 and its Rules. **The periods and deadlines below are placeholders to be set by
the clinic's compliance adviser**: this repository cannot decide what the law requires. Where a
number is shown it is the value the code is configured with today, not a legal conclusion.

## 1. Retention

| Data | Current behaviour | Decision needed |
|---|---|---|
| Clinical records (visits, case sheets, prescriptions, labs) | Kept indefinitely; visits have no delete path. | Minimum and maximum retention period for outpatient records. |
| Audit trail (`AuditLog`) | Configured retention 7 years (`auditRetentionDays: 2555`); nothing purges it. | Confirm 7 years; add a purge job only after the decision. |
| Backups | `BACKUP_RETENTION_DAYS` = 365. | Whether backups may hold erased data for that long (see section 2). |
| Consent ledger | Append-only, kept with the patient record. | Same period as the clinical record. |
| Security events (JWT guard) | 30 days. | - |

Rule of thumb until decided: **do not delete clinical data**. Deleting is irreversible and the
patient's right of erasure is limited by legal retention duties.

## 2. Erasure / correction request from a patient

1. Record the request (date, requester, how identity was verified) outside the application until a
   request register exists. Verify identity before acting: the request itself is a data-theft vector.
2. Decide with the adviser what must be kept (records the clinic is legally required to retain) and
   what may go (marketing contacts, unverified contact points, non-clinical profile data).
3. Correction: edit through the normal screens. Every change is audited.
4. Erasure of what may go:
   - Contact points: `DELETE FROM patient_contact_points WHERE "patientId" = ...` (after step 2).
   - Account deactivation: the patient can deactivate their own account (`UsersService`), which
     soft-deletes (`deletedAt`) and keeps the clinical record.
   - Clinical rows that must be erased need a reviewed script; none exists. Do not hand-delete visits:
     other tables reference them.
5. Backups are not edited. Document that erased data ages out of backups after
   `BACKUP_RETENTION_DAYS`, and make sure a restore re-applies pending erasures.
6. Withdrawal of consent is recorded with `POST /compliance/consents` (`status: WITHDRAWN`); it does
   not by itself delete data.
7. Log the outcome in the request register and reply to the patient within the period the adviser sets.

## 3. Personal-data breach response

Trigger: any confirmed or suspected unauthorised access, loss or disclosure of patient data (lost
laptop with a session, leaked key or database dump, misdirected export, a bug that returned another
patient's record).

1. **Contain (first hour).** Revoke exposed credentials and sessions; rotate secrets that may have
   leaked (JWT secret, DB password, `FIELD_ENCRYPTION_KEY` *after* planning re-encryption, provider
   keys); take the affected route offline or behind the IP whitelist if needed.
2. **Preserve evidence.** Do not restart or redeploy before copying logs. Snapshot the database and
   the relevant container logs. Keep the `AuditLog` rows (`PHI_*`) for the window in question.
3. **Scope.** Using the audit queries in `README.md`, list which patients' records were read or
   exported, by whom, and when. `PHI_EXPORT` (FHIR `$everything`) is the highest-impact action.
4. **Assess.** What data (identity, diagnoses, contact), how many people, any children or
   vulnerable patients, was the data encrypted (free-text fields only, once the key is set).
5. **Notify.** The DPDP Act requires intimation to the Data Protection Board and to affected data
   principals in the form and time the Rules prescribe. Have the adviser confirm the current
   deadline and template **now**, not during an incident. Record who was told, when, and what.
6. **Fix and verify.** Patch, add a regression test, and review whether the audit trail would have
   caught it sooner.
7. **Post-incident review** within two weeks: timeline, root cause, what changes.

Incident contacts to fill in: clinic owner, compliance adviser, hosting provider (Contabo support),
developer on call.
