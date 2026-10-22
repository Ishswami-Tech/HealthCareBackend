/**
 * Records behind the prescription PDF letterhead and the optional sections, all read from the
 * prescription's own clinic / patient / visit (nothing clinic specific is hardcoded):
 *  - clinic: name, address, phone, email, logo, business code (clinics row of prescription.clinicId)
 *  - allergies: Allergy rows of the patient's user (this clinic or clinic-less) + the visit's
 *    drug / food allergy notes
 *  - weight: the visit's vitals examination, else the latest "weight" Vital of the patient
 *  - investigations: investigation_orders linked to the same visit / appointment
 *  - follow-up: the appointment's FollowUpPlan (not cancelled / completed)
 *  - draftedByName: the assistant who drafted the prescription
 * Optional sections fail soft (logged, omitted); only the clinic row falls back to "Clinic".
 */
import type { DatabaseService } from '@infrastructure/database';
import type { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import type {
  PrescriptionPdfFollowUp,
  PrescriptionPdfInvestigation,
} from '@services/pharmacy/services/prescription-pdf.types';

type Row = Record<string, string | number | boolean | Date | null | object | undefined>;
type Args = Record<string, object | string | number | boolean | null>;

interface Delegate {
  findFirst: (args: Args) => Promise<Row | null>;
  findMany: (args: Args) => Promise<Row[]>;
}

interface PdfContextClient {
  clinic?: Delegate;
  allergy?: Delegate;
  vital?: Delegate;
  patientVisit?: Delegate;
  visitVitalsExamination?: Delegate;
  investigationOrder?: Delegate;
  followUpPlan?: Delegate;
  user?: Delegate;
}

export interface PrescriptionPdfContextInput {
  readonly clinicId: string;
  readonly patientId: string;
  readonly patientUserId?: string | null;
  readonly visitId?: string | null;
  readonly appointmentId?: string | null;
  readonly draftedByUserId?: string | null;
}

export interface PrescriptionPdfClinic {
  readonly name: string;
  readonly code: string | null;
  readonly address: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly logo: string | null;
}

export interface PrescriptionPdfContext {
  readonly clinic: PrescriptionPdfClinic;
  readonly allergies: readonly string[];
  readonly weight: string | null;
  readonly investigations: readonly PrescriptionPdfInvestigation[];
  readonly followUp: PrescriptionPdfFollowUp | null;
  readonly draftedByName: string | null;
}

const text = (value: Row[string]): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const FALLBACK_CLINIC: PrescriptionPdfClinic = {
  name: 'Clinic',
  code: null,
  address: null,
  phone: null,
  email: null,
  logo: null,
};

async function loadClinic(
  client: PdfContextClient,
  clinicId: string
): Promise<PrescriptionPdfClinic> {
  const row = await client.clinic?.findFirst({
    where: { id: clinicId },
    select: { name: true, clinicId: true, address: true, phone: true, email: true, logo: true },
  });
  if (!row) return FALLBACK_CLINIC;
  return {
    name: text(row['name']) ?? FALLBACK_CLINIC.name,
    code: text(row['clinicId']),
    address: text(row['address']),
    phone: text(row['phone']),
    email: text(row['email']),
    logo: text(row['logo']),
  };
}

async function loadAllergies(
  client: PdfContextClient,
  input: PrescriptionPdfContextInput
): Promise<string[]> {
  const rows = input.patientUserId
    ? ((await client.allergy?.findMany({
        where: {
          userId: input.patientUserId,
          OR: [{ clinicId: input.clinicId }, { clinicId: null }],
        },
        orderBy: { diagnosedDate: 'desc' },
        select: { allergen: true },
        take: 10,
      })) ?? [])
    : [];
  const visit = input.visitId
    ? await client.patientVisit?.findFirst({
        where: { id: input.visitId, clinicId: input.clinicId },
        select: { drugAllergyNotes: true, foodAllergyNotes: true },
      })
    : null;
  const names = [
    ...rows.map(row => text(row['allergen'])),
    text(visit?.['drugAllergyNotes']),
    text(visit?.['foodAllergyNotes']),
  ].filter(
    (name): name is string => Boolean(name) && !/^(none|nil|no|nkda|na|n\/a)$/i.test(String(name))
  );
  return Array.from(new Set(names));
}

async function loadWeight(
  client: PdfContextClient,
  input: PrescriptionPdfContextInput
): Promise<string | null> {
  if (input.visitId) {
    const vitals = await client.visitVitalsExamination?.findFirst({
      where: { visitId: input.visitId },
      select: { weightKg: true },
    });
    const kg = vitals?.['weightKg'];
    if (typeof kg === 'number' && kg > 0) return `${Math.round(kg * 10) / 10} kg`;
  }
  if (!input.patientUserId) return null;
  const vital = await client.vital?.findFirst({
    where: {
      userId: input.patientUserId,
      type: { contains: 'weight', mode: 'insensitive' },
      OR: [{ clinicId: input.clinicId }, { clinicId: null }],
    },
    orderBy: { recordedAt: 'desc' },
    select: { value: true, unit: true },
  });
  const value = text(vital?.['value']);
  return value ? [value, text(vital?.['unit']) ?? 'kg'].join(' ') : null;
}

function toInvestigations(rows: readonly Row[]): PrescriptionPdfInvestigation[] {
  return rows.flatMap(row => {
    const tests = Array.isArray(row['tests'])
      ? (row['tests'] as Array<Record<string, string>>)
      : [];
    const urgency = text(row['urgency']);
    return tests
      .map(test => ({
        name: typeof test?.['name'] === 'string' ? test['name'].trim() : '',
        kind: test?.['kind'] ?? null,
        urgency,
      }))
      .filter(test => test.name.length > 0);
  });
}

async function loadInvestigations(
  client: PdfContextClient,
  input: PrescriptionPdfContextInput
): Promise<PrescriptionPdfInvestigation[]> {
  const links = [
    ...(input.visitId ? [{ visitId: input.visitId }] : []),
    ...(input.appointmentId ? [{ appointmentId: input.appointmentId }] : []),
  ];
  if (links.length === 0 || !client.investigationOrder) return [];
  const rows = await client.investigationOrder.findMany({
    where: {
      clinicId: input.clinicId,
      patientId: input.patientId,
      status: { not: 'CANCELLED' },
      OR: links,
    },
    orderBy: { orderedAt: 'asc' },
    select: { tests: true, urgency: true },
    take: 20,
  });
  return toInvestigations(rows);
}

async function loadFollowUp(
  client: PdfContextClient,
  input: PrescriptionPdfContextInput
): Promise<PrescriptionPdfFollowUp | null> {
  if (!input.appointmentId) return null;
  const plan = await client.followUpPlan?.findFirst({
    where: {
      appointmentId: input.appointmentId,
      clinicId: input.clinicId,
      status: { notIn: ['cancelled', 'completed', 'CANCELLED', 'COMPLETED'] },
    },
    select: { scheduledFor: true, instructions: true, followUpType: true },
  });
  const scheduledFor = plan?.['scheduledFor'];
  if (!(scheduledFor instanceof Date) && typeof scheduledFor !== 'string') return null;
  return {
    scheduledFor,
    instructions: text(plan?.['instructions']),
    followUpType: text(plan?.['followUpType']),
  };
}

async function loadDrafterName(
  client: PdfContextClient,
  userId?: string | null
): Promise<string | null> {
  if (!userId) return null;
  const user = await client.user?.findFirst({ where: { id: userId }, select: { name: true } });
  return text(user?.['name']);
}

type PdfReader = <T>(run: (client: PdfContextClient) => Promise<T>) => Promise<T>;

/**
 * Runs one section in its own read, so a failing optional query cannot affect the others; a
 * failure is logged and the section omitted.
 */
async function soft<T>(
  read: PdfReader,
  logging: LoggingService,
  section: string,
  fallback: T,
  run: (client: PdfContextClient) => Promise<T>
): Promise<T> {
  try {
    return await read(run);
  } catch (error) {
    await logging.log(
      LogType.SYSTEM,
      LogLevel.WARN,
      `Prescription PDF: ${section} not loaded`,
      'PharmacyService',
      { error: error instanceof Error ? error.message : String(error) }
    );
    return fallback;
  }
}

export async function loadPrescriptionPdfContext(
  database: DatabaseService,
  logging: LoggingService,
  input: PrescriptionPdfContextInput
): Promise<PrescriptionPdfContext> {
  const read: PdfReader = run =>
    database.executeHealthcareRead(raw => run(raw as unknown as PdfContextClient));
  const [clinic, allergies, weight, investigations, followUp, draftedByName] = await Promise.all([
    soft(read, logging, 'clinic', FALLBACK_CLINIC, client => loadClinic(client, input.clinicId)),
    soft(read, logging, 'allergies', [] as string[], client => loadAllergies(client, input)),
    soft(read, logging, 'weight', null, client => loadWeight(client, input)),
    soft(read, logging, 'investigations', [] as PrescriptionPdfInvestigation[], client =>
      loadInvestigations(client, input)
    ),
    soft(read, logging, 'follow-up', null, client => loadFollowUp(client, input)),
    soft(read, logging, 'drafter', null, client => loadDrafterName(client, input.draftedByUserId)),
  ]);
  return { clinic, allergies, weight, investigations, followUp, draftedByName };
}
