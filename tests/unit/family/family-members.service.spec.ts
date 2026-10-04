/**
 * Unit tests for FamilyMembersService: dependent cap for patient self-service and
 * clinic scoping helpers for the staff routes.
 */

import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import {
  DEPENDENT_CREATION_WINDOW_DAYS,
  FamilyMembersService,
  MAX_ACTIVE_DEPENDENTS_PER_PATIENT,
  MAX_DEPENDENT_CREATIONS_PER_WINDOW,
} from '@services/patient-visits/services/family-members.service';
import type { CreateFamilyMemberDto } from '@dtos/family-member.dto';

jest.mock('@infrastructure/database', () => ({ DatabaseService: class DatabaseService {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@infrastructure/events/event.service', () => ({ EventService: class EventService {} }));
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));

const CLINIC = 'clinic-1';
const ACTOR = { userId: 'user-self', role: 'PATIENT' };

const DTO: CreateFamilyMemberDto = {
  primaryPatientId: 'patient-self',
  firstName: 'Aarav',
  lastName: 'Bhujbal',
  relation: 'Son',
  gender: 'MALE',
  dateOfBirth: '2018-04-12',
};

function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fam-1',
    patientId: 'patient-self',
    userId: 'user-child',
    firstName: 'Aarav',
    lastName: 'Bhujbal',
    relation: 'Son',
    gender: 'MALE',
    dateOfBirth: new Date('2018-04-12T00:00:00Z'),
    phone: null,
    notes: null,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

/** Cache fake with real lock semantics (SET NX): a held lock refuses further acquirers. */
function createLockingCache() {
  const held = new Set<string>();
  return {
    held,
    acquireLock: jest.fn(async (key: string) => {
      if (held.has(key)) return false;
      held.add(key);
      return true;
    }),
    releaseLock: jest.fn(async (key: string) => held.delete(key)),
  };
}

function createHarness(
  options: { activeDependents?: number; recentCreations?: number; patientInClinic?: boolean } = {}
) {
  const client = {
    patient: {
      findUnique: jest.fn().mockResolvedValue({ id: 'patient-self' }),
      findFirst: jest
        .fn()
        .mockResolvedValue(options.patientInClinic === false ? null : { id: 'patient-self' }),
      findMany: jest.fn().mockResolvedValue([{ id: 'patient-child', userId: 'user-child' }]),
    },
    familyMember: {
      // ACTIVE count vs rolling-window count are told apart by the where clause
      count: jest.fn(async ({ where }: { where: { createdAt?: unknown } }) =>
        where.createdAt === undefined
          ? (options.activeDependents ?? 0)
          : (options.recentCreations ?? options.activeDependents ?? 0)
      ),
      findFirst: jest.fn().mockResolvedValue(memberRow()),
      findMany: jest.fn().mockResolvedValue([memberRow()]),
    },
  };
  const databaseService = {
    executeHealthcareRead: jest.fn(async (operation: (c: unknown) => Promise<unknown>) =>
      operation(client)
    ),
    executeHealthcareWrite: jest
      .fn()
      .mockResolvedValue({ member: memberRow(), dependentPatientId: 'patient-child' }),
  };
  const loggingService = { log: jest.fn().mockResolvedValue(undefined) };
  const eventService = { emit: jest.fn().mockResolvedValue(undefined) };
  const cache = createLockingCache();
  const service = new FamilyMembersService(
    databaseService as never,
    loggingService as never,
    eventService as never,
    cache as never
  );
  return { service, client, databaseService, cache };
}

describe('FamilyMembersService.createFamilyMember dependent cap', () => {
  it('is 10 active dependents per primary patient', () => {
    expect(MAX_ACTIVE_DEPENDENTS_PER_PATIENT).toBe(10);
  });

  it('rejects the 11th active dependent with 409 and writes nothing', async () => {
    const h = createHarness({ activeDependents: 10 });

    await expect(
      h.service.createFamilyMember(DTO, CLINIC, ACTOR, {
        maxActiveDependents: MAX_ACTIVE_DEPENDENTS_PER_PATIENT,
      })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.databaseService.executeHealthcareWrite).not.toHaveBeenCalled();
  });

  it('error message states the limit', async () => {
    const h = createHarness({ activeDependents: 10 });

    await expect(
      h.service.createFamilyMember(DTO, CLINIC, ACTOR, { maxActiveDependents: 10 })
    ).rejects.toThrow('at most 10 family members');
  });

  it('allows the 10th dependent', async () => {
    const h = createHarness({ activeDependents: 9 });

    const created = await h.service.createFamilyMember(DTO, CLINIC, ACTOR, {
      maxActiveDependents: 10,
    });

    expect(created.id).toBe('fam-1');
    expect(h.databaseService.executeHealthcareWrite).toHaveBeenCalledTimes(1);
  });

  it('counts only ACTIVE, non-deleted links of that head of family', async () => {
    const h = createHarness({ activeDependents: 0 });

    await h.service.createFamilyMember(DTO, CLINIC, ACTOR, { maxActiveDependents: 10 });

    expect(h.client.familyMember.count).toHaveBeenCalledWith({
      where: { patientId: 'patient-self', isActive: true, deletedAt: null },
    });
  });

  it('does not cap staff registrations (no option passed, no count query)', async () => {
    const h = createHarness({ activeDependents: 50 });

    await expect(h.service.createFamilyMember(DTO, CLINIC, ACTOR)).resolves.toMatchObject({
      id: 'fam-1',
    });
    expect(h.client.familyMember.count).not.toHaveBeenCalled();
  });
});

describe('FamilyMembersService staff clinic scoping', () => {
  it('assertPatientInClinic passes when the patient belongs to the clinic', async () => {
    const h = createHarness();

    await expect(h.service.assertPatientInClinic('patient-self', CLINIC)).resolves.toBeUndefined();
    expect(h.client.patient.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'patient-self',
        OR: [
          { user: { primaryClinicId: CLINIC } },
          { user: { clinics: { some: { id: CLINIC } } } },
          { user: { userRoles: { some: { clinicId: CLINIC, isActive: true } } } },
          { appointments: { some: { clinicId: CLINIC } } },
        ],
      },
      select: { id: true },
    });
  });

  it('assertPatientInClinic is a 404 for a patient of another clinic', async () => {
    const h = createHarness({ patientInClinic: false });

    await expect(h.service.assertPatientInClinic('patient-x', CLINIC)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('assertMemberInClinic resolves the member head of family and checks the clinic', async () => {
    const h = createHarness();

    await expect(h.service.assertMemberInClinic('fam-1', CLINIC)).resolves.toBeUndefined();
    expect(h.client.patient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'patient-self' }) })
    );
  });

  it('assertMemberInClinic reports a member of another clinic as "Family member ... not found"', async () => {
    const h = createHarness({ patientInClinic: false });

    await expect(h.service.assertMemberInClinic('fam-1', CLINIC)).rejects.toThrow(
      'Family member fam-1 not found'
    );
  });

  it('assertMemberInClinic is a 404 for an unknown or removed member', async () => {
    const h = createHarness();
    h.client.familyMember.findFirst.mockResolvedValue(null);

    await expect(h.service.assertMemberInClinic('fam-missing', CLINIC)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(h.client.patient.findFirst).not.toHaveBeenCalled();
  });

  it('listFamilyMembers lists the ACTIVE dependents of the head of family', async () => {
    const h = createHarness();

    const members = await h.service.listFamilyMembers('patient-self');

    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ id: 'fam-1', dependentPatientId: 'patient-child' });
    expect(h.client.familyMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { patientId: 'patient-self', isActive: true, deletedAt: null },
      })
    );
  });
});
