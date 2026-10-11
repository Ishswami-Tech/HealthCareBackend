/**
 * Turns mapped register rows into an import plan: which patients to create, which to attach to a
 * patient already in the system, and which visits to add. Pure and deterministic: the same file
 * always yields the same plan and the same visit numbers, which is what makes a re-run safe.
 */
import type { MappedRegisterRow, RegisterIssue } from './register-mapper';

/** What the database already holds, loaded by the runner before planning. */
export interface ExistingState {
  /** legacy register number -> patientId, for patients created by an earlier run. */
  readonly legacyToPatientId: ReadonlyMap<string, string>;
  /** `${normalisedName}|${+91 mobile}` -> patientId, only when exactly one patient matches. */
  readonly uniquePatientByNameAndMobile: ReadonlyMap<string, string>;
  /** Visit numbers already present for the clinic. */
  readonly opdNumbers: ReadonlySet<string>;
}

export type PatientMode = 'NEW' | 'ALREADY_IMPORTED' | 'LINK_EXISTING';

export interface PlannedVisit {
  readonly rowNumber: number;
  readonly opdNumber: string;
  readonly legacyOpd: string | null;
  readonly caseDate: string;
  readonly referenceSource: string | null;
  readonly ayurvedicDiagnosis: string | null;
  readonly modernDiagnosis: string | null;
}

export interface PlannedPatient {
  readonly legacyRegistration: string;
  readonly mode: PatientMode;
  /** Set for ALREADY_IMPORTED and LINK_EXISTING. */
  readonly existingPatientId: string | null;
  /** Demographics, the newest non-empty value of each field across the patient's rows. */
  readonly profile: MappedRegisterRow;
  readonly firstCaseDate: string;
  /** Visits that are not in the database yet. */
  readonly visits: readonly PlannedVisit[];
  readonly visitsAlreadyPresent: number;
}

export interface ImportPlan {
  readonly patients: readonly PlannedPatient[];
  readonly issueCounts: Readonly<Partial<Record<RegisterIssue, number>>>;
}

export const normaliseName = (name: string): string =>
  name.toLowerCase().replace(/\s+/g, ' ').trim();

export const nameAndMobileKey = (name: string, mobile: string): string =>
  `${normaliseName(name)}|${mobile}`;

/** Visit number carried over from the register: `VM-<register OPD no>`, suffixed on collision. */
export function assignOpdNumber(
  row: Pick<MappedRegisterRow, 'legacyOpd' | 'legacyRegistration'>,
  taken: Set<string>
): string {
  const base = `VM-${row.legacyOpd ?? row.legacyRegistration}`;
  let candidate = base;
  if (taken.has(candidate)) candidate = `${base}~${row.legacyRegistration}`;
  for (let n = 2; taken.has(candidate); n += 1) {
    candidate = `${base}~${row.legacyRegistration}~${n}`;
  }
  taken.add(candidate);
  return candidate;
}

function newestNonEmpty<K extends keyof MappedRegisterRow>(
  rowsNewestFirst: readonly MappedRegisterRow[],
  key: K
): MappedRegisterRow[K] {
  for (const row of rowsNewestFirst) {
    const value = row[key];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return (rowsNewestFirst[0] as MappedRegisterRow)[key];
}

function mergeProfile(rowsNewestFirst: readonly MappedRegisterRow[]): MappedRegisterRow {
  const newest = rowsNewestFirst[0] as MappedRegisterRow;
  const pick = <K extends keyof MappedRegisterRow>(key: K): MappedRegisterRow[K] =>
    newestNonEmpty(rowsNewestFirst, key);
  return {
    ...newest,
    gender: pick('gender'),
    age: pick('age'),
    dateOfBirth: pick('dateOfBirth'),
    email: pick('email'),
    mobile: pick('mobile'),
    address: pick('address'),
    city: pick('city'),
    state: pick('state'),
    country: pick('country'),
    referenceSource: pick('referenceSource'),
  };
}

export function buildPlan(
  rows: readonly MappedRegisterRow[],
  existing: ExistingState,
  options: { limitPatients?: number } = {}
): ImportPlan {
  const issueCounts: Partial<Record<RegisterIssue, number>> = {};
  const byPatient = new Map<string, MappedRegisterRow[]>();
  for (const row of rows) {
    for (const issue of row.issues) issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
    const group = byPatient.get(row.legacyRegistration);
    if (group) group.push(row);
    else byPatient.set(row.legacyRegistration, [row]);
  }

  // Visit numbers are assigned over the whole file in file order, independent of what the
  // database holds, so a re-run reproduces the same numbers.
  const taken = new Set<string>();
  const opdByRow = new Map<number, string>();
  for (const row of rows) opdByRow.set(row.rowNumber, assignOpdNumber(row, taken));

  const patients: PlannedPatient[] = [];
  for (const [legacyRegistration, group] of byPatient) {
    const newestFirst = [...group].sort((a, b) => b.caseDate.localeCompare(a.caseDate));
    const profile = mergeProfile(newestFirst);
    const importedId = existing.legacyToPatientId.get(legacyRegistration) ?? null;
    const linkedId =
      importedId === null && profile.mobile
        ? (existing.uniquePatientByNameAndMobile.get(
            nameAndMobileKey(profile.name, profile.mobile)
          ) ?? null)
        : null;

    const allVisits: PlannedVisit[] = [...group]
      .sort((a, b) => a.caseDate.localeCompare(b.caseDate) || a.rowNumber - b.rowNumber)
      .map(row => ({
        rowNumber: row.rowNumber,
        opdNumber: opdByRow.get(row.rowNumber) as string,
        legacyOpd: row.legacyOpd,
        caseDate: row.caseDate,
        referenceSource: row.referenceSource,
        ayurvedicDiagnosis: row.ayurvedicDiagnosis,
        modernDiagnosis: row.modernDiagnosis,
      }));
    const visits = allVisits.filter(visit => !existing.opdNumbers.has(visit.opdNumber));

    patients.push({
      legacyRegistration,
      mode: importedId ? 'ALREADY_IMPORTED' : linkedId ? 'LINK_EXISTING' : 'NEW',
      existingPatientId: importedId ?? linkedId,
      profile,
      firstCaseDate: (allVisits[0] as PlannedVisit).caseDate,
      visits,
      visitsAlreadyPresent: allVisits.length - visits.length,
    });
  }

  const limited =
    options.limitPatients !== undefined ? patients.slice(0, options.limitPatients) : patients;
  return { patients: limited, issueCounts };
}

export interface PlanSummary {
  readonly patientsNew: number;
  readonly patientsLinkedToExisting: number;
  readonly patientsAlreadyImported: number;
  readonly visitsToCreate: number;
  readonly visitsAlreadyPresent: number;
  readonly newPatientsWithMobile: number;
  readonly newPatientsWithEmail: number;
  readonly diagnosesToCreate: number;
  readonly mobilesSharedByNewPatients: number;
}

export function summarisePlan(plan: ImportPlan): PlanSummary {
  const mobileCounts = new Map<string, number>();
  let newWithMobile = 0;
  let newWithEmail = 0;
  let visits = 0;
  let present = 0;
  let diagnoses = 0;
  const count = { NEW: 0, LINK_EXISTING: 0, ALREADY_IMPORTED: 0 };
  for (const patient of plan.patients) {
    count[patient.mode] += 1;
    visits += patient.visits.length;
    present += patient.visitsAlreadyPresent;
    diagnoses += patient.visits.filter(visit => visit.ayurvedicDiagnosis !== null).length;
    if (patient.mode === 'NEW') {
      if (patient.profile.mobile) {
        newWithMobile += 1;
        mobileCounts.set(
          patient.profile.mobile,
          (mobileCounts.get(patient.profile.mobile) ?? 0) + 1
        );
      }
      if (patient.profile.email) newWithEmail += 1;
    }
  }
  return {
    patientsNew: count.NEW,
    patientsLinkedToExisting: count.LINK_EXISTING,
    patientsAlreadyImported: count.ALREADY_IMPORTED,
    visitsToCreate: visits,
    visitsAlreadyPresent: present,
    newPatientsWithMobile: newWithMobile,
    newPatientsWithEmail: newWithEmail,
    diagnosesToCreate: diagnoses,
    mobilesSharedByNewPatients: [...mobileCounts.values()].filter(n => n > 1).length,
  };
}
