# ADR: tenant (clinic) isolation

Status: accepted for now; database row-level security (RLS) is a recommended follow-up, not done.

## Context

The system is multi-tenant by clinic. Today there is exactly one clinic in production, so isolation
has never been exercised against a second tenant. Cross-clinic leakage is the highest-severity
failure for a multi-clinic EHR.

## What enforces isolation today (all in application code)

- `ClinicGuard` derives `req.clinicContext.clinicId` from the authenticated user and the request.
- Services take `clinicId` and put it in `where` clauses (`patient_visits`, `patient_identifiers`,
  `patient_consents`, ...). `Patient` itself has no `clinicId`: a patient "belongs" to a clinic
  through `EHRService.resolvePatient` (primary clinic, membership, active role, or an appointment).
- `ClinicIsolationService` / `RowLevelSecurityService` exist as application-level helpers; neither
  sets anything in the database session.
- Cache keys are clinic-scoped.

Weakness: one forgotten `clinicId` filter in any query leaks data. Nothing in the database stops it.

## Decision

Keep application-level enforcement and add database RLS as defence in depth **later**, because
turning RLS on without per-request tenant context breaks every query.

## Why not now

`DatabaseService.executeHealthcareWrite/Read` do not wrap a callback in one transaction (documented
in `PatientVisitsService.allocateOpdNumber`), so a `SET LOCAL app.clinic_id = ...` cannot be relied
on to apply to every statement of a request on the same connection, and the connection pool would
otherwise carry one request's tenant into another's. With `FORCE ROW LEVEL SECURITY` and a policy
that compares `clinicId` to that setting, the failure mode is the opposite of what is wanted:
queries return nothing (or everything, if the setting leaks).

## Proposed design

1. Every tenant table carries `clinicId` (done for the newer tables; `Patient` and some older tables
   do not: needs a membership table or a denormalised column first).
2. `DatabaseService` runs each request's work inside one transaction and starts it with
   `SELECT set_config('app.clinic_id', $1, true)` (transaction-local).
3. Policies: `USING ("clinicId" = current_setting('app.clinic_id', true))`, with `FORCE ROW LEVEL
   SECURITY` and a separate maintenance role that bypasses RLS for migrations and the importer.
4. Roll out table by table, behind a flag, starting with the tables that hold PHI
   (`patient_visits`, `patient_identifiers`, `patient_consents`, `patient_contact_points`).
5. Tests: a two-clinic fixture where every PHI endpoint is called with clinic A's token for clinic
   B's ids and must return 404; run in CI.

## Consequences

Until then a second clinic must not be onboarded without a manual review of every query that touches
patient data, and the two-clinic test above should be written first.
