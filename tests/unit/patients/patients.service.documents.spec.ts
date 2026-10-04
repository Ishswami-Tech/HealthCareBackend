/**
 * Unit tests for patient document authorization, upload hardening and doctor
 * attribution in PatientsService.
 *
 * Nothing that decides access is mocked away: the patient / clinic-membership lookup
 * (`getPatientRecordForClinic`) runs for real against a stateful fake of the patient and
 * health-record tables, and staff permissions are decided by the REAL `RbacService`
 * role-permission map (only its storage collaborators are faked).
 */

import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { PatientsService } from '@services/patients/patients.service';
import { RbacService } from '@core/rbac/rbac.service';

jest.mock('@infrastructure/database', () => ({ DatabaseService: class DatabaseService {} }));
jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@infrastructure/logging/logging.service', () => ({
  LoggingService: class LoggingService {},
}));
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));
jest.mock('@infrastructure/storage/static-asset.service', () => ({
  AssetType: { DOCUMENT: 'documents' },
  StaticAssetService: class StaticAssetService {},
}));
jest.mock('@core/rbac/role.service', () => ({ RoleService: class RoleService {} }));
jest.mock('@core/rbac/permission.service', () => ({
  PermissionService: class PermissionService {},
}));
jest.mock('@services/appointments/appointments.service', () => ({
  AppointmentsService: class AppointmentsService {},
}));
jest.mock('@services/ehr/ehr.service', () => ({ EHRService: class EHRService {} }));
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));
jest.mock('@services/pharmacy/services/pharmacy.service', () => ({
  PharmacyService: class PharmacyService {},
}));

const CLINIC = 'clinic-1';
const OTHER_CLINIC = 'clinic-2';
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);

interface PatientRow {
  id: string;
  userId: string;
  primaryClinicId: string | null;
  /** Clinics the patient has an appointment in. */
  appointmentClinicIds: string[];
}

const OWN_PATIENT = { id: 'patient-self', userId: 'user-self' };
const CHILD_PATIENT = { id: 'patient-child', userId: 'user-child' };
const OTHER_PATIENT = { id: 'patient-other', userId: 'user-other' };

const DEFAULT_PATIENTS: PatientRow[] = [
  { ...OWN_PATIENT, primaryClinicId: CLINIC, appointmentClinicIds: [] },
  { ...CHILD_PATIENT, primaryClinicId: CLINIC, appointmentClinicIds: [] },
  { ...OTHER_PATIENT, primaryClinicId: CLINIC, appointmentClinicIds: [] },
  // belongs to ANOTHER clinic only: no link whatsoever to CLINIC
  {
    id: 'patient-elsewhere',
    userId: 'user-elsewhere',
    primaryClinicId: OTHER_CLINIC,
    appointmentClinicIds: [],
  },
];

type Actor =
  | 'PATIENT'
  | 'DOCTOR'
  | 'ASSISTANT_DOCTOR'
  | 'RECEPTIONIST'
  | 'CLINIC_ADMIN'
  | 'SUPER_ADMIN'
  | 'NURSE'
  | 'PHARMACIST'
  | 'THERAPIST'
  | 'LAB_TECHNICIAN';

/** The staff user id encodes the role so the real RbacService fallback can resolve it. */
function userIdFor(role: Actor): string {
  return role === 'PATIENT' ? 'user-self' : `staff-${role}`;
}

function auditFor(role: Actor, operation: string, userId = userIdFor(role), clinicId = CLINIC) {
  return { userId, userRole: role, operation, resourceType: 'HEALTH_RECORD', clinicId };
}

interface DocumentRow {
  id: string;
  patientId: string;
  clinicId: string;
  recordType: string;
  uploadedBy?: string | null | undefined;
  fileUrl?: string | null | undefined;
  title?: string;
  createdAt: Date;
  [key: string]: unknown;
}

type RbacMode = 'real' | 'allow-all' | 'deny-all' | 'missing';

interface HarnessOptions {
  /** How staff permissions are decided (default: the REAL RbacService map). */
  rbac?: RbacMode;
  /** The calling patient has an ACTIVE dependent (CHILD_PATIENT). */
  withDependent?: boolean;
  /** Replace the patient table. */
  patients?: PatientRow[];
  /** Initial health-record rows. */
  documents?: DocumentRow[];
  uploaded?: { success: boolean; url?: string; key?: string; localPath?: string; error?: string };
  deleteAssetResult?: boolean | Error;
}

interface WhereClause {
  id?: string;
  patientId?: string;
  clinicId?: string;
  recordType?: string;
  OR?: Array<{ id?: string; userId?: string }>;
  userId?: string | { in: string[] };
}

function createRealRbac(): RbacService {
  const cache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidateCache: jest.fn().mockResolvedValue(undefined),
    invalidateByPattern: jest.fn().mockResolvedValue(undefined),
  };
  const database = {
    findUserRolesSafe: jest.fn().mockResolvedValue([]),
    findRolePermissionsSafe: jest.fn().mockResolvedValue([]),
    findUserByIdSafe: jest.fn(async (userId: string) => ({
      id: userId,
      role: userId.replace(/^staff-/, ''),
    })),
  };
  const logging = { log: jest.fn().mockResolvedValue(undefined) };
  return new RbacService(
    {} as never,
    {} as never,
    database as never,
    cache as never,
    logging as never
  );
}

function createHarness(options: HarnessOptions = {}) {
  const patients = options.patients ?? DEFAULT_PATIENTS;
  const documents: DocumentRow[] = [...(options.documents ?? [])];

  const matches = (row: DocumentRow, where: WhereClause): boolean =>
    (where.id === undefined || row.id === where.id) &&
    (where.patientId === undefined || row.patientId === where.patientId) &&
    (where.clinicId === undefined || row.clinicId === where.clinicId) &&
    (where.recordType === undefined || row.recordType === where.recordType);

  const client = {
    healthRecord: {
      findFirst: jest.fn(async ({ where }: { where: WhereClause }) => {
        return documents.find(row => matches(row, where)) ?? null;
      }),
      findMany: jest.fn(async ({ where }: { where: WhereClause }) =>
        documents.filter(row => matches(row, where))
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'doc-new',
        createdAt: new Date('2026-02-01T00:00:00Z'),
        recordType: 'GENERAL_DOCUMENT',
        ...data,
      })),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const index = documents.findIndex(row => row.id === where.id);
        if (index >= 0) documents.splice(index, 1);
        return {};
      }),
    },
    patient: {
      // Serves three callers: the clinic-scoped lookup (select.appointments), the plain
      // identifier lookup, and the access-scope lookup of the calling PATIENT.
      findFirst: jest.fn(
        async ({
          where,
          select,
        }: {
          where: WhereClause;
          select?: { appointments?: { where: { clinicId: string } } };
        }) => {
          const row = where.OR
            ? patients.find(candidate =>
                where.OR?.some(
                  condition =>
                    condition.id === candidate.id || condition.userId === candidate.userId
                )
              )
            : patients.find(candidate => candidate.userId === where.userId);
          if (!row) return null;
          if (select?.appointments) {
            const clinicId = select.appointments.where.clinicId;
            return {
              id: row.id,
              userId: row.userId,
              user: { primaryClinicId: row.primaryClinicId },
              appointments: row.appointmentClinicIds.includes(clinicId) ? [{ id: 'apt-1' }] : [],
            };
          }
          return { id: row.id, userId: row.userId };
        }
      ),
      findMany: jest.fn(async ({ where }: { where: WhereClause }) => {
        const wanted =
          typeof where.userId === 'object' && where.userId !== null ? where.userId.in : [];
        return patients
          .filter(row => wanted.includes(row.userId))
          .map(row => ({ id: row.id, userId: row.userId }));
      }),
    },
    familyMember: {
      findMany: jest
        .fn()
        .mockResolvedValue(options.withDependent ? [{ userId: CHILD_PATIENT.userId }] : []),
    },
    doctor: { findUnique: jest.fn().mockResolvedValue(null) },
    appointment: { findFirst: jest.fn().mockResolvedValue({ doctorId: 'doctor-last' }) },
    doctorClinic: { findFirst: jest.fn().mockResolvedValue(null) },
  };

  const databaseService = {
    executeHealthcareRead: jest.fn(async (operation: (c: unknown) => Promise<unknown>) =>
      operation(client)
    ),
    executeHealthcareWrite: jest.fn(
      async (operation: (c: unknown) => Promise<unknown>, _audit: unknown) => operation(client)
    ),
  };
  const loggingService = { log: jest.fn().mockResolvedValue(undefined) };
  const staticAssetService = {
    uploadFile: jest.fn().mockResolvedValue(
      options.uploaded ?? {
        success: true,
        url: '/storage/assets/documents/u-doc.pdf',
        key: 'documents/u-doc.pdf',
      }
    ),
    deleteAsset:
      options.deleteAssetResult instanceof Error
        ? jest.fn().mockRejectedValue(options.deleteAssetResult)
        : jest.fn().mockResolvedValue(options.deleteAssetResult ?? true),
    // Local-disk URLs stay as they are; own-bucket URLs get a (fake) signature.
    resolveSignedUrl: jest.fn(async (url: string) =>
      url.startsWith('/storage/') ? url : `${url}?X-Amz-Signature=sig`
    ),
  };
  const cacheService = { cache: jest.fn() };

  const rbacMode = options.rbac ?? 'real';
  const realRbac = createRealRbac();
  const checkPermission = jest.spyOn(realRbac, 'checkPermission');
  if (rbacMode === 'allow-all' || rbacMode === 'deny-all') {
    checkPermission.mockResolvedValue({
      hasPermission: rbacMode === 'allow-all',
      roles: [],
      permissions: [],
    });
  }

  const service = new PatientsService(
    databaseService as never,
    loggingService as never,
    staticAssetService as never,
    cacheService as never,
    undefined,
    undefined,
    undefined,
    undefined,
    rbacMode === 'missing' ? undefined : (realRbac as never)
  );

  return {
    service,
    client,
    documents,
    databaseService,
    loggingService,
    staticAssetService,
    checkPermission,
    realRbac,
  };
}

function storedDocument(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: 'doc-1',
    patientId: 'patient-self',
    clinicId: CLINIC,
    recordType: 'GENERAL_DOCUMENT',
    uploadedBy: 'user-self',
    fileUrl:
      'https://cdn.example.com/documents/0f8fad5b-d9cb-469f-a165-70867728950e-doc-patient-self-1.pdf',
    createdAt: new Date('2026-02-01T00:00:00Z'),
    ...overrides,
  };
}

describe('PatientsService.deletePatientDocument authorization matrix', () => {
  it('PATIENT deletes a document they uploaded to their own record; actor role is audited and the file is removed', async () => {
    const h = createHarness({ documents: [storedDocument()] });

    const result = await h.service.deletePatientDocument(
      'patient-self',
      'doc-1',
      auditFor('PATIENT', 'DELETE')
    );

    expect(result).toEqual({ success: true, id: 'doc-1' });
    expect(h.client.healthRecord.delete).toHaveBeenCalledWith({ where: { id: 'doc-1' } });
    const audit = h.databaseService.executeHealthcareWrite.mock.calls[0]?.[1] as {
      userRole: string;
    };
    expect(audit.userRole).toBe('PATIENT');
    expect(h.staticAssetService.deleteAsset).toHaveBeenCalledWith(
      'documents/0f8fad5b-d9cb-469f-a165-70867728950e-doc-patient-self-1.pdf'
    );
    expect(h.checkPermission).not.toHaveBeenCalled();
  });

  it('PATIENT cannot delete a document of another patient (403) and nothing is deleted', async () => {
    const h = createHarness({
      documents: [storedDocument({ patientId: 'patient-other', uploadedBy: 'user-other' })],
    });

    await expect(
      h.service.deletePatientDocument('patient-other', 'doc-1', auditFor('PATIENT', 'DELETE'))
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.client.healthRecord.delete).not.toHaveBeenCalled();
    expect(h.staticAssetService.deleteAsset).not.toHaveBeenCalled();
  });

  it('PATIENT may delete a document they uploaded for an ACTIVE dependent', async () => {
    const h = createHarness({
      withDependent: true,
      documents: [storedDocument({ patientId: 'patient-child' })],
    });

    await expect(
      h.service.deletePatientDocument('patient-child', 'doc-1', auditFor('PATIENT', 'DELETE'))
    ).resolves.toEqual({ success: true, id: 'doc-1' });
  });

  it('PATIENT cannot delete a clinic-uploaded document, even on their own record', async () => {
    const h = createHarness({ documents: [storedDocument({ uploadedBy: 'doctor-user' })] });

    await expect(
      h.service.deletePatientDocument('patient-self', 'doc-1', auditFor('PATIENT', 'DELETE'))
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.client.healthRecord.delete).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])(
    'PATIENT cannot delete a document whose uploadedBy is %s (staff-uploaded / legacy row)',
    async (_label, uploadedBy) => {
      const h = createHarness({ documents: [storedDocument({ uploadedBy })] });

      await expect(
        h.service.deletePatientDocument('patient-self', 'doc-1', auditFor('PATIENT', 'DELETE'))
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.client.healthRecord.delete).not.toHaveBeenCalled();
      expect(h.staticAssetService.deleteAsset).not.toHaveBeenCalled();
    }
  );

  it('staff (DOCTOR) can still delete a row with a null uploadedBy', async () => {
    const h = createHarness({ documents: [storedDocument({ uploadedBy: null })] });

    await expect(
      h.service.deletePatientDocument('patient-self', 'doc-1', auditFor('DOCTOR', 'DELETE'))
    ).resolves.toEqual({ success: true, id: 'doc-1' });
  });

  it('DOCTOR with the REAL permission map deletes, and the real role (not "system") is audited', async () => {
    const h = createHarness({
      documents: [storedDocument({ patientId: 'patient-other', uploadedBy: 'user-other' })],
    });

    await expect(
      h.service.deletePatientDocument('patient-other', 'doc-1', auditFor('DOCTOR', 'DELETE'))
    ).resolves.toEqual({ success: true, id: 'doc-1' });

    const audit = h.databaseService.executeHealthcareWrite.mock.calls[0]?.[1] as {
      userRole: string;
      userId: string;
      clinicId: string;
    };
    expect(audit).toMatchObject({
      userRole: 'DOCTOR',
      userId: 'staff-DOCTOR',
      clinicId: CLINIC,
    });
    expect(h.checkPermission).toHaveBeenCalledWith(
      expect.objectContaining({ resource: 'medical-records', action: 'delete' })
    );
  });

  it('a clinical role whose RBAC check fails is denied (RBAC stays a second lock)', async () => {
    const h = createHarness({ rbac: 'deny-all' });

    await expect(
      h.service.deletePatientDocument('patient-other', 'doc-1', auditFor('DOCTOR', 'DELETE'))
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.client.healthRecord.delete).not.toHaveBeenCalled();
  });

  it('fails closed when RBAC is not wired', async () => {
    const h = createHarness({ rbac: 'missing' });

    await expect(
      h.service.deletePatientDocument('patient-other', 'doc-1', auditFor('CLINIC_ADMIN', 'DELETE'))
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(h.client.healthRecord.delete).not.toHaveBeenCalled();
  });

  it('cross-clinic patient: staff of another clinic get 403 (real clinic-membership lookup)', async () => {
    const h = createHarness();

    await expect(
      h.service.deletePatientDocument('patient-elsewhere', 'doc-1', auditFor('DOCTOR', 'DELETE'))
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.client.healthRecord.delete).not.toHaveBeenCalled();
  });

  it('cross-clinic document: the staff lookup is clinic scoped, so another clinic document is a 404', async () => {
    const h = createHarness({
      documents: [
        storedDocument({ id: 'doc-elsewhere', patientId: 'patient-other', clinicId: OTHER_CLINIC }),
      ],
    });

    await expect(
      h.service.deletePatientDocument(
        'patient-other',
        'doc-elsewhere',
        auditFor('DOCTOR', 'DELETE')
      )
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.client.healthRecord.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'doc-elsewhere',
        patientId: 'patient-other',
        clinicId: CLINIC,
        recordType: 'GENERAL_DOCUMENT',
      },
    });
    expect(h.client.healthRecord.delete).not.toHaveBeenCalled();
  });

  it('a storage failure never fails the request (logged only)', async () => {
    const h = createHarness({
      documents: [storedDocument()],
      deleteAssetResult: new Error('s3 unavailable'),
    });

    await expect(
      h.service.deletePatientDocument('patient-self', 'doc-1', auditFor('PATIENT', 'DELETE'))
    ).resolves.toEqual({ success: true, id: 'doc-1' });
    expect(h.loggingService.log).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining('Failed to remove patient document file'),
      'PatientsService',
      expect.objectContaining({ error: 's3 unavailable' })
    );
  });

  it('a file that could not be removed is logged, the request still succeeds', async () => {
    const h = createHarness({ documents: [storedDocument()], deleteAssetResult: false });

    await expect(
      h.service.deletePatientDocument('patient-self', 'doc-1', auditFor('PATIENT', 'DELETE'))
    ).resolves.toEqual({ success: true, id: 'doc-1' });
    expect(h.loggingService.log).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining('was not removed from storage'),
      'PatientsService',
      expect.anything()
    );
  });

  it('does not attempt a storage delete for an unrecognised fileUrl', async () => {
    const h = createHarness({
      documents: [storedDocument({ fileUrl: 'https://evil.example/other/x' })],
    });

    await h.service.deletePatientDocument('patient-self', 'doc-1', auditFor('PATIENT', 'DELETE'));

    expect(h.staticAssetService.deleteAsset).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a medical-records/ object attached to a document row (S3)',
      'https://cdn.example.com/medical-records/uuid-doc-record-1-1.pdf',
      'medical-records/uuid-doc-record-1-1.pdf',
    ],
    [
      'a legacy nested medical-records/ object',
      'https://cdn.example.com/medical-records/uuid-medical-record/user-self/record-1-1.pdf',
      'medical-records/uuid-medical-record/user-self/record-1-1.pdf',
    ],
    [
      'a local-disk medical-records/ file',
      '/storage/assets/medical-records/uuid-doc-record-1-1.pdf',
      '/storage/assets/medical-records/uuid-doc-record-1-1.pdf',
    ],
    [
      'a local-disk documents/ file',
      '/storage/assets/documents/uuid-doc-patient-self-1.pdf',
      '/storage/assets/documents/uuid-doc-patient-self-1.pdf',
    ],
  ])('removes the stored file for %s', async (_label, fileUrl, expectedRef) => {
    const h = createHarness({ documents: [storedDocument({ fileUrl })] });

    await h.service.deletePatientDocument('patient-self', 'doc-1', auditFor('PATIENT', 'DELETE'));

    expect(h.staticAssetService.deleteAsset).toHaveBeenCalledWith(expectedRef);
  });
});

describe('PatientsService document access by non-clinical roles (real RBAC permission map)', () => {
  const DENIED_ROLES: Actor[] = [
    'RECEPTIONIST',
    'NURSE',
    'PHARMACIST',
    'THERAPIST',
    'LAB_TECHNICIAN',
  ];
  const ALLOWED_STAFF: Actor[] = ['DOCTOR', 'ASSISTANT_DOCTOR', 'CLINIC_ADMIN', 'SUPER_ADMIN'];

  it.each(DENIED_ROLES)(
    '%s is denied list and delete by the service itself, with the real RBAC map and even when RBAC allows everything',
    async role => {
      for (const rbac of ['real', 'allow-all'] as const) {
        const h = createHarness({ rbac, documents: [storedDocument()] });

        await expect(
          h.service.listPatientDocuments('patient-self', auditFor(role, 'READ'))
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          h.service.deletePatientDocument('patient-self', 'doc-1', auditFor(role, 'DELETE'))
        ).rejects.toBeInstanceOf(ForbiddenException);

        // decided by the role allow-list: no RBAC lookup, no patient lookup, no query
        expect(h.checkPermission).not.toHaveBeenCalled();
        expect(h.client.patient.findFirst).not.toHaveBeenCalled();
        expect(h.client.healthRecord.findMany).not.toHaveBeenCalled();
        expect(h.client.healthRecord.delete).not.toHaveBeenCalled();
      }
    }
  );

  it('the role allow-list is checked before RBAC availability (a denied role never reaches the 500)', async () => {
    const h = createHarness({ rbac: 'missing' });

    await expect(
      h.service.listPatientDocuments('patient-self', auditFor('RECEPTIONIST', 'READ'))
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an unknown or missing role is denied (fail closed)', async () => {
    const h = createHarness({ rbac: 'allow-all' });

    await expect(
      h.service.listPatientDocuments('patient-self', {
        ...auditFor('DOCTOR', 'READ'),
        userRole: '',
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      h.service.listPatientDocuments('patient-self', {
        ...auditFor('DOCTOR', 'READ'),
        userRole: 'JANITOR',
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(ALLOWED_STAFF)(
    '%s passes the real permission map and may list and delete documents',
    async role => {
      const h = createHarness({ documents: [storedDocument(), storedDocument({ id: 'doc-2' })] });

      await expect(
        h.service.listPatientDocuments('patient-self', auditFor(role, 'READ'))
      ).resolves.toHaveLength(2);
      await expect(
        h.service.deletePatientDocument('patient-self', 'doc-1', auditFor(role, 'DELETE'))
      ).resolves.toEqual({ success: true, id: 'doc-1' });
      expect(h.checkPermission).toHaveBeenCalledWith(
        expect.objectContaining({ resource: 'medical-records', action: 'read' })
      );
      expect(h.checkPermission).toHaveBeenCalledWith(
        expect.objectContaining({ resource: 'medical-records', action: 'delete' })
      );
    }
  );
});

describe('PatientsService.listPatientDocuments authorization', () => {
  it('PATIENT lists their own documents (filtered by patient, not by request clinic)', async () => {
    const h = createHarness();

    await expect(
      h.service.listPatientDocuments('patient-self', auditFor('PATIENT', 'READ'))
    ).resolves.toEqual([]);
    expect(h.client.healthRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { patientId: 'patient-self', recordType: 'GENERAL_DOCUMENT' },
      })
    );
  });

  it('PATIENT may address themselves by User.id as well', async () => {
    const h = createHarness({ documents: [storedDocument()] });

    await expect(
      h.service.listPatientDocuments('user-self', auditFor('PATIENT', 'READ'))
    ).resolves.toHaveLength(1);
  });

  it('PATIENT cannot list another patient documents (403)', async () => {
    const h = createHarness({
      documents: [storedDocument({ patientId: 'patient-other', uploadedBy: 'user-other' })],
    });

    await expect(
      h.service.listPatientDocuments('patient-other', auditFor('PATIENT', 'READ'))
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.client.healthRecord.findMany).not.toHaveBeenCalled();
  });

  it('an unknown patient id gets the same 403 for a PATIENT (no existence oracle)', async () => {
    const h = createHarness();

    await expect(
      h.service.listPatientDocuments('does-not-exist', auditFor('PATIENT', 'READ'))
    ).rejects.toThrow('You can only view your own documents');
    expect(h.client.healthRecord.findMany).not.toHaveBeenCalled();
  });

  it('PATIENT can list an ACTIVE dependent documents', async () => {
    const h = createHarness({
      withDependent: true,
      documents: [storedDocument({ patientId: 'patient-child' })],
    });

    await expect(
      h.service.listPatientDocuments('patient-child', auditFor('PATIENT', 'READ'))
    ).resolves.toHaveLength(1);
  });

  it('staff lists only the documents of the request clinic', async () => {
    const h = createHarness({
      documents: [
        storedDocument({ id: 'here' }),
        storedDocument({ id: 'there', clinicId: OTHER_CLINIC }),
      ],
    });

    const documents = await h.service.listPatientDocuments(
      'patient-self',
      auditFor('DOCTOR', 'READ')
    );

    expect(documents.map(d => d.id)).toEqual(['here']);
    expect(h.client.healthRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { patientId: 'patient-self', clinicId: CLINIC, recordType: 'GENERAL_DOCUMENT' },
      })
    );
  });

  it('staff of a clinic the patient has no link to get 403 (real membership lookup)', async () => {
    const h = createHarness();

    await expect(
      h.service.listPatientDocuments('patient-elsewhere', auditFor('DOCTOR', 'READ'))
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.client.healthRecord.findMany).not.toHaveBeenCalled();
  });
});

describe('PatientsService documents of a patient registered with several clinics', () => {
  // The patient's only link is to OTHER_CLINIC; today they use CLINIC (no primary clinic
  // there, no appointment there) -> the old clinic gate answered 403 for their own data.
  const MULTI_CLINIC_PATIENTS: PatientRow[] = [
    { ...OWN_PATIENT, primaryClinicId: OTHER_CLINIC, appointmentClinicIds: [] },
    ...DEFAULT_PATIENTS.slice(1),
  ];
  const DOCS = [
    storedDocument({ id: 'doc-a', clinicId: CLINIC }),
    storedDocument({ id: 'doc-b', clinicId: OTHER_CLINIC }),
  ];

  it('the patient lists their documents of ALL clinics regardless of the clinic in use', async () => {
    const h = createHarness({ patients: MULTI_CLINIC_PATIENTS, documents: DOCS });

    const documents = await h.service.listPatientDocuments(
      'user-self',
      auditFor('PATIENT', 'READ', 'user-self', CLINIC)
    );

    expect(documents.map(d => d.id).sort()).toEqual(['doc-a', 'doc-b']);
    const where = (
      h.client.healthRecord.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    ).where;
    expect(where).not.toHaveProperty('clinicId');
  });

  it('the same documents are listed when the other clinic is in use', async () => {
    const h = createHarness({ patients: MULTI_CLINIC_PATIENTS, documents: DOCS });

    const documents = await h.service.listPatientDocuments(
      'user-self',
      auditFor('PATIENT', 'READ', 'user-self', OTHER_CLINIC)
    );

    expect(documents.map(d => d.id).sort()).toEqual(['doc-a', 'doc-b']);
  });

  it('the patient can delete their own document of another clinic', async () => {
    const h = createHarness({ patients: MULTI_CLINIC_PATIENTS, documents: DOCS });

    await expect(
      h.service.deletePatientDocument(
        'user-self',
        'doc-b',
        auditFor('PATIENT', 'DELETE', 'user-self', CLINIC)
      )
    ).resolves.toEqual({ success: true, id: 'doc-b' });

    // the audit trail names the clinic the row belongs to
    const audit = h.databaseService.executeHealthcareWrite.mock.calls[0]?.[1] as {
      clinicId: string;
    };
    expect(audit.clinicId).toBe(OTHER_CLINIC);
  });

  it('ownership still applies: another patient documents stay out of reach in every clinic', async () => {
    const h = createHarness({
      patients: MULTI_CLINIC_PATIENTS,
      documents: [
        storedDocument({ id: 'doc-x', patientId: 'patient-other', clinicId: OTHER_CLINIC }),
      ],
    });

    await expect(
      h.service.listPatientDocuments(
        'patient-other',
        auditFor('PATIENT', 'READ', 'user-self', OTHER_CLINIC)
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      h.service.deletePatientDocument(
        'patient-other',
        'doc-x',
        auditFor('PATIENT', 'DELETE', 'user-self', OTHER_CLINIC)
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('staff stay clinic-scoped: the same patient is 403 for staff of a clinic they have no link to', async () => {
    const h = createHarness({ patients: MULTI_CLINIC_PATIENTS, documents: DOCS });

    await expect(
      h.service.listPatientDocuments(
        'patient-self',
        auditFor('DOCTOR', 'READ', 'staff-DOCTOR', CLINIC)
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('uploading is the one write that stays clinic-gated: no link to the request clinic is a 403', async () => {
    const h = createHarness({ patients: MULTI_CLINIC_PATIENTS });

    await expect(
      h.service.uploadPatientDocument(
        'user-self',
        { buffer: PDF, mimetype: 'application/pdf', originalname: 'a.pdf', size: PDF.length },
        auditFor('PATIENT', 'CREATE', 'user-self', CLINIC)
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.staticAssetService.uploadFile).not.toHaveBeenCalled();
  });
});

describe('PatientsService.uploadPatientDocument hardening', () => {
  function upload(
    h: ReturnType<typeof createHarness>,
    file: { buffer: Buffer; mimetype: string; originalname: string },
    meta: { category?: string; description?: string } = {}
  ) {
    return h.service.uploadPatientDocument(
      'patient-self',
      { ...file, size: file.buffer.length },
      auditFor('PATIENT', 'CREATE'),
      meta
    );
  }

  it('rejects an empty buffer (400) before anything is stored', async () => {
    const h = createHarness();
    await expect(
      upload(h, { buffer: Buffer.alloc(0), mimetype: 'application/pdf', originalname: 'a.pdf' })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.staticAssetService.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects files over 10 MB with 413', async () => {
    const h = createHarness();
    const big = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024, 0x20)]);
    await expect(
      upload(h, { buffer: big, mimetype: 'application/pdf', originalname: 'a.pdf' })
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(h.staticAssetService.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects a disallowed type (400)', async () => {
    const h = createHarness();
    await expect(
      upload(h, {
        buffer: Buffer.from('<html><body>hi there</body></html>'),
        mimetype: 'text/html',
        originalname: 'a.html',
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.staticAssetService.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects an invalid category and an over-long description (400)', async () => {
    const h = createHarness();
    const file = { buffer: PDF, mimetype: 'application/pdf', originalname: 'a.pdf' };
    await expect(upload(h, file, { category: 'NOPE' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(upload(h, file, { description: 'x'.repeat(501) })).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(h.staticAssetService.uploadFile).not.toHaveBeenCalled();
  });

  it('stores with the canonical mime type, sanitised title and category, and audits the real role', async () => {
    const h = createHarness();

    const result = await upload(
      h,
      {
        buffer: PDF,
        mimetype: 'application/octet-stream',
        originalname: '../../secret/Blood Report.pdf',
      },
      { category: 'lab_report', description: ' fasting ' }
    );

    expect(h.staticAssetService.uploadFile).toHaveBeenCalledWith(
      PDF,
      expect.stringMatching(/^doc-patient-self-\d+\.pdf$/),
      'documents',
      'application/pdf',
      false
    );
    const created = h.client.healthRecord.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(created.data).toMatchObject({
      patientId: 'patient-self',
      clinicId: CLINIC,
      doctorId: 'doctor-last',
      uploadedBy: 'user-self',
      title: 'Blood Report.pdf',
      report: 'LAB_REPORT',
      notes: 'fasting',
      mimeType: 'application/pdf',
      fileSize: PDF.length,
    });
    const audit = h.databaseService.executeHealthcareWrite.mock.calls[0]?.[1] as {
      userRole: string;
    };
    expect(audit.userRole).toBe('PATIENT');
    expect(result).toMatchObject({
      id: 'doc-new',
      category: 'LAB_REPORT',
      fileName: 'Blood Report.pdf',
    });
  });

  it.each([
    ['success=false', { success: false, error: 'disk full' }],
    ['no url', { success: true, key: 'documents/x' }],
  ])(
    'throws when the storage result is unusable (%s) and writes no row',
    async (_label, uploaded) => {
      const h = createHarness({ uploaded });
      await expect(
        upload(h, { buffer: PDF, mimetype: 'application/pdf', originalname: 'a.pdf' })
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(h.client.healthRecord.create).not.toHaveBeenCalled();
    }
  );

  it('removes the stored object when the row cannot be written, and rethrows', async () => {
    const h = createHarness();
    h.client.healthRecord.create.mockRejectedValue(new Error('insert failed'));

    await expect(
      upload(h, { buffer: PDF, mimetype: 'application/pdf', originalname: 'a.pdf' })
    ).rejects.toThrow('insert failed');
    expect(h.staticAssetService.deleteAsset).toHaveBeenCalledWith('documents/u-doc.pdf');
  });

  it('cleans up a local-disk upload through its relative /storage reference, never the absolute disk path', async () => {
    const h = createHarness({
      uploaded: {
        success: true,
        url: '/storage/assets/documents/u-doc.pdf',
        localPath: 'C:/work/storage/assets/documents/u-doc.pdf',
      },
    });
    h.client.healthRecord.create.mockRejectedValue(new Error('insert failed'));

    await expect(
      upload(h, { buffer: PDF, mimetype: 'application/pdf', originalname: 'a.pdf' })
    ).rejects.toThrow('insert failed');
    expect(h.staticAssetService.deleteAsset).toHaveBeenCalledWith(
      '/storage/assets/documents/u-doc.pdf'
    );
  });

  it('a PATIENT cannot upload to another patient record (403) and nothing is validated or stored', async () => {
    const h = createHarness();

    await expect(
      h.service.uploadPatientDocument(
        'patient-other',
        { buffer: PDF, mimetype: 'application/pdf', originalname: 'a.pdf', size: PDF.length },
        auditFor('PATIENT', 'CREATE')
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.staticAssetService.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects the upload with a clear message when no doctor can be attributed', async () => {
    const h = createHarness();
    h.client.appointment.findFirst.mockResolvedValue(null);
    h.client.doctorClinic.findFirst.mockResolvedValue(null);

    await expect(
      upload(h, { buffer: PDF, mimetype: 'application/pdf', originalname: 'a.pdf' })
    ).rejects.toThrow('No doctor is linked to your record in this clinic yet');
    expect(h.staticAssetService.uploadFile).not.toHaveBeenCalled();
  });
});

describe('PatientsService doctor attribution for documents', () => {
  type Resolver = (
    patientId: string,
    uploaderUserId: string,
    clinicId: string
  ) => Promise<string | null>;

  function resolver(h: ReturnType<typeof createHarness>): Resolver {
    return (
      h.service as unknown as { resolveDoctorIdForDocument: Resolver }
    ).resolveDoctorIdForDocument.bind(h.service);
  }

  it('uses the uploader when they are a doctor and runs no further query', async () => {
    const h = createHarness();
    h.client.doctor.findUnique.mockResolvedValue({ id: 'doctor-uploader' });

    await expect(resolver(h)('patient-1', 'user-doc', CLINIC)).resolves.toBe('doctor-uploader');
    expect(h.client.appointment.findFirst).not.toHaveBeenCalled();
    expect(h.client.doctorClinic.findFirst).not.toHaveBeenCalled();
  });

  it('prefers the doctor of the patient most recent appointment in this clinic (deterministic order)', async () => {
    const h = createHarness();
    h.client.appointment.findFirst.mockResolvedValue({ doctorId: 'doctor-last' });

    await expect(resolver(h)('patient-1', 'user-1', CLINIC)).resolves.toBe('doctor-last');
    expect(h.client.appointment.findFirst).toHaveBeenCalledWith({
      where: { patientId: 'patient-1', clinicId: CLINIC },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      select: { doctorId: true },
    });
    expect(h.client.doctorClinic.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to the longest-standing ACTIVE doctor of the clinic, in a fixed order', async () => {
    const h = createHarness();
    h.client.appointment.findFirst.mockResolvedValue(null);
    h.client.doctorClinic.findFirst.mockResolvedValue({ doctorId: 'doctor-oldest' });

    await expect(resolver(h)('patient-1', 'user-1', CLINIC)).resolves.toBe('doctor-oldest');
    expect(h.client.doctorClinic.findFirst).toHaveBeenCalledWith({
      where: { clinicId: CLINIC, doctor: { user: { isActive: true } } },
      orderBy: [{ doctor: { createdAt: 'asc' } }, { doctorId: 'asc' }],
      select: { doctorId: true },
    });
  });

  it('returns null when the clinic has no active doctor (upload then reports "No doctor is linked")', async () => {
    const h = createHarness();
    h.client.appointment.findFirst.mockResolvedValue(null);

    await expect(resolver(h)('patient-1', 'user-1', CLINIC)).resolves.toBeNull();
  });
});

describe('PatientsService.uploadPatientDocument for a dependent', () => {
  const PDF_FILE = { buffer: PDF, mimetype: 'application/pdf', originalname: 'scan.pdf' };

  function uploadTo(
    h: ReturnType<typeof createHarness>,
    patientId: string,
    role: Actor = 'PATIENT'
  ) {
    return h.service.uploadPatientDocument(
      patientId,
      { ...PDF_FILE, size: PDF.length },
      auditFor(role, 'CREATE'),
      {}
    );
  }

  it('PATIENT uploads to their OWN record', async () => {
    const h = createHarness();

    await expect(uploadTo(h, 'patient-self')).resolves.toMatchObject({ id: 'doc-new' });
    // Own User.id is decided without any family lookup.
    expect(h.client.familyMember.findMany).not.toHaveBeenCalled();
  });

  it('PATIENT uploads to an ACTIVE dependent: attributed to the dependent record, uploader recorded', async () => {
    const h = createHarness({ withDependent: true });
    h.client.appointment.findFirst.mockResolvedValue({ doctorId: 'doctor-of-child' });

    await expect(uploadTo(h, 'patient-child')).resolves.toMatchObject({
      id: 'doc-new',
      uploadedBy: 'user-self',
    });

    const created = h.client.healthRecord.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(created.data).toMatchObject({
      patientId: 'patient-child',
      clinicId: CLINIC,
      // doctor attribution follows the dependent's own appointments, never a User.id
      doctorId: 'doctor-of-child',
      // the uploader is the guardian: this is what "delete only what you uploaded" compares
      uploadedBy: 'user-self',
    });
    expect(h.client.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { patientId: 'patient-child', clinicId: CLINIC } })
    );
    expect(h.staticAssetService.uploadFile).toHaveBeenCalledWith(
      PDF,
      expect.stringMatching(/^doc-patient-child-\d+\.pdf$/),
      'documents',
      'application/pdf',
      false
    );
  });

  it('the guardian can then delete exactly the document they uploaded for the dependent', async () => {
    const h = createHarness({
      withDependent: true,
      documents: [
        storedDocument({ id: 'doc-new', patientId: 'patient-child', uploadedBy: 'user-self' }),
        storedDocument({ id: 'doc-clinic', patientId: 'patient-child', uploadedBy: 'doctor-user' }),
      ],
    });

    await expect(
      h.service.deletePatientDocument('patient-child', 'doc-new', auditFor('PATIENT', 'DELETE'))
    ).resolves.toEqual({ success: true, id: 'doc-new' });

    await expect(
      h.service.deletePatientDocument('patient-child', 'doc-clinic', auditFor('PATIENT', 'DELETE'))
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a stranger gets 403 and nothing is validated, stored or written', async () => {
    const h = createHarness({ withDependent: true });

    await expect(uploadTo(h, 'patient-other')).rejects.toBeInstanceOf(ForbiddenException);

    expect(h.staticAssetService.uploadFile).not.toHaveBeenCalled();
    expect(h.client.healthRecord.create).not.toHaveBeenCalled();
  });

  it('an INACTIVE or soft-deleted dependent grants nothing (403): only active, non-deleted links are queried', async () => {
    // The family-link query filters out inactive / deleted links, so none comes back.
    const h = createHarness({ withDependent: false });

    await expect(uploadTo(h, 'patient-child')).rejects.toBeInstanceOf(ForbiddenException);

    expect(h.client.familyMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { patientId: 'patient-self', isActive: true, deletedAt: null },
      })
    );
    expect(h.staticAssetService.uploadFile).not.toHaveBeenCalled();
    expect(h.client.healthRecord.create).not.toHaveBeenCalled();
  });

  it('a caller without a Patient row cannot upload for anyone but themselves', async () => {
    const h = createHarness({ withDependent: true });
    h.client.patient.findFirst.mockImplementation(async ({ where }: { where: WhereClause }) =>
      where.OR
        ? {
            id: 'patient-child',
            userId: 'user-child',
            user: { primaryClinicId: CLINIC },
            appointments: [],
          }
        : null
    );

    await expect(uploadTo(h, 'patient-child')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('staff behaviour is unchanged: no patient-scope lookup, the staff user is the uploader', async () => {
    const h = createHarness();

    await expect(uploadTo(h, 'patient-child', 'DOCTOR')).resolves.toMatchObject({ id: 'doc-new' });

    // only the clinic-membership lookup ran: nothing resolves a PATIENT access scope
    expect(h.client.familyMember.findMany).not.toHaveBeenCalled();
    const created = h.client.healthRecord.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(created.data).toMatchObject({ uploadedBy: 'staff-DOCTOR' });
  });
});

describe('PatientsService patient documents are private and served via presigned URLs', () => {
  const OWN_BUCKET_URL =
    'https://cdn.example.com/documents/0f8fad5b-d9cb-469f-a165-70867728950e-doc-patient-self-1.pdf';
  const SIGNED_OWN_BUCKET_URL = `${OWN_BUCKET_URL}?X-Amz-Signature=sig`;

  it('stores the upload PRIVATE, persists the stored URL and returns the presigned URL', async () => {
    const h = createHarness({
      uploaded: { success: true, url: OWN_BUCKET_URL, key: 'documents/u-doc.pdf' },
    });

    const result = await h.service.uploadPatientDocument(
      'patient-self',
      { buffer: PDF, mimetype: 'application/pdf', originalname: 'a.pdf', size: PDF.length },
      auditFor('PATIENT', 'CREATE')
    );

    expect(h.staticAssetService.uploadFile.mock.calls[0]?.[4]).toBe(false);
    const created = h.client.healthRecord.create.mock.calls[0]?.[0] as {
      data: { fileUrl: string };
    };
    expect(created.data.fileUrl).toBe(OWN_BUCKET_URL);
    expect(result.url).toBe(SIGNED_OWN_BUCKET_URL);
  });

  it('binds every presign to the row owner: the object key must carry the Patient.id or User.id', async () => {
    const h = createHarness({
      documents: [storedDocument({ id: 'd1', fileUrl: OWN_BUCKET_URL })],
    });

    await h.service.listPatientDocuments('patient-self', auditFor('PATIENT', 'READ'));

    expect(h.staticAssetService.resolveSignedUrl).toHaveBeenCalledWith(OWN_BUCKET_URL, undefined, {
      boundTo: ['patient-self', 'user-self'],
    });
  });

  it('lists documents with presigned URLs in the same `url` field; local-disk URLs are untouched', async () => {
    const h = createHarness({
      documents: [
        storedDocument({
          id: 'd1',
          title: 'a.pdf',
          report: 'LAB_REPORT',
          fileUrl: OWN_BUCKET_URL,
          createdAt: new Date('2026-02-01T00:00:00Z'),
        }),
        storedDocument({
          id: 'd2',
          title: 'b.pdf',
          fileUrl: '/storage/assets/documents/local.pdf',
          createdAt: new Date('2026-02-02T00:00:00Z'),
        }),
        storedDocument({
          id: 'd3',
          title: 'c.pdf',
          fileUrl: null,
          createdAt: new Date('2026-02-03T00:00:00Z'),
        }),
      ],
    });

    const documents = await h.service.listPatientDocuments(
      'patient-self',
      auditFor('PATIENT', 'READ')
    );

    expect(documents.map(d => [d.id, d.url])).toEqual([
      ['d1', SIGNED_OWN_BUCKET_URL],
      ['d2', '/storage/assets/documents/local.pdf'],
      ['d3', undefined],
    ]);
    expect(h.staticAssetService.resolveSignedUrl).toHaveBeenCalledTimes(2);
    // the response shape clients rely on is unchanged
    expect(Object.keys(documents[0] ?? {}).sort()).toEqual(
      [
        'category',
        'description',
        'fileName',
        'fileSize',
        'fileType',
        'id',
        'recordType',
        'uploadedAt',
        'uploadedBy',
        'url',
      ].sort()
    );
  });

  it('a presign that falls back to the stored URL still lists (resolveSignedUrl never rejects)', async () => {
    const h = createHarness({
      documents: [storedDocument({ id: 'd1', title: 'a.pdf', fileUrl: OWN_BUCKET_URL })],
    });
    h.staticAssetService.resolveSignedUrl.mockImplementation(async (url: string) => url);

    const documents = await h.service.listPatientDocuments(
      'patient-self',
      auditFor('PATIENT', 'READ')
    );

    expect(documents[0]?.url).toBe(OWN_BUCKET_URL);
  });
});
