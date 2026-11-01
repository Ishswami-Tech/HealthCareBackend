/**
 * Unit tests for UsersService: list / read / delete paths.
 *
 * The profile read and update paths (emergency contact, profile fields, signed photo URL)
 * are covered in users.service.profile-read.spec.ts.
 */

import { UsersService } from '@services/users/users.service';
import { Role } from '@core/types/enums.types';

type Deps = ConstructorParameters<typeof UsersService>;

const NOW = new Date('2026-03-01T00:00:00Z');

function userRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'user-123',
    email: 'test@healthcare.com',
    password: '$2b$12$secret',
    firstName: 'Test',
    lastName: 'User',
    role: Role.PATIENT,
    isVerified: true,
    isProfileComplete: true,
    phone: '+919876543210',
    phoneVerified: true,
    createdAt: NOW,
    updatedAt: NOW,
    dateOfBirth: null,
    primaryClinicId: 'clinic-1',
    patient: { id: 'patient-1' },
    ...over,
  };
}

function createHarness(
  options: {
    users?: Array<Record<string, unknown>>;
    user?: Record<string, unknown> | null;
    hasPermission?: boolean;
  } = {}
) {
  const user = options.user === undefined ? userRow() : options.user;
  const client = {
    user: {
      findMany: jest.fn().mockResolvedValue(options.users ?? [userRow()]),
      findUnique: jest.fn().mockResolvedValue(user),
    },
    emergencyContact: { findFirst: jest.fn().mockResolvedValue(null) },
    patient: {
      findUnique: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue({}),
    },
    doctor: { delete: jest.fn().mockResolvedValue({}) },
  };
  const databaseService = {
    findUserByIdSafe: jest.fn().mockResolvedValue(user),
    deleteUserSafe: jest.fn().mockResolvedValue(undefined),
    executeHealthcareRead: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
    executeHealthcareWrite: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
  };
  const cacheService = {
    cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
    invalidateCache: jest.fn().mockResolvedValue(undefined),
    invalidateCacheByTag: jest.fn().mockResolvedValue(undefined),
  };
  const loggingService = { log: jest.fn().mockResolvedValue(undefined) };
  const eventService = {
    emit: jest.fn().mockResolvedValue(undefined),
    emitAsync: jest.fn(),
    emitEnterprise: jest.fn(),
    on: jest.fn(),
    onAny: jest.fn(),
  };
  const patientsService = {
    resolveProfilePhotoUrl: jest.fn(async (_id: string, url: string) => url),
    ensurePatientProfile: jest.fn().mockResolvedValue(undefined),
  };
  const rbacService = {
    checkPermission: jest.fn().mockResolvedValue({ hasPermission: options.hasPermission ?? true }),
  };
  const errors = {
    userNotFound: jest.fn((id: string) => new Error(`User ${id} not found`)),
    insufficientPermissions: jest.fn(() => new Error('Insufficient permissions')),
  };

  const service = new UsersService(
    databaseService as unknown as Deps[0],
    cacheService as unknown as Deps[1],
    loggingService as unknown as Deps[2],
    eventService as unknown as Deps[3],
    patientsService as unknown as Deps[4],
    rbacService as unknown as Deps[5],
    {} as unknown as Deps[6],
    errors as unknown as Deps[7]
  );

  return { service, client, databaseService, cacheService, eventService, rbacService, errors };
}

describe('UsersService', () => {
  describe('constructor', () => {
    it('refuses an invalid EventService', () => {
      expect(
        () =>
          new UsersService(
            {} as unknown as Deps[0],
            {} as unknown as Deps[1],
            {} as unknown as Deps[2],
            { emit: jest.fn() } as unknown as Deps[3],
            {} as unknown as Deps[4],
            {} as unknown as Deps[5],
            {} as unknown as Deps[6],
            {} as unknown as Deps[7]
          )
      ).toThrow('EventService is not available or invalid');
    });
  });

  describe('findAll', () => {
    it('maps users and never exposes the password', async () => {
      const h = createHarness();

      const result = await h.service.findAll(undefined, 'clinic-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'user-123',
        email: 'test@healthcare.com',
        firstName: 'Test',
        role: Role.PATIENT,
        isVerified: true,
        phoneVerified: true,
      });
      expect(result[0]).not.toHaveProperty('password');
    });

    it('filters by role and clinic', async () => {
      const h = createHarness();

      await h.service.findAll(Role.DOCTOR, 'clinic-1');

      expect(h.client.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role: Role.DOCTOR, clinics: { some: { id: 'clinic-1' } } },
          include: expect.objectContaining({ doctor: true, patient: false }),
        })
      );
    });

    it('does not filter by clinic when no clinicId is given', async () => {
      const h = createHarness();

      await h.service.findAll(Role.PATIENT);

      expect(h.client.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { role: Role.PATIENT } })
      );
    });

    it('scopes the cache key by role, clinic and location', async () => {
      const h = createHarness();

      // 8ac60356 added the location segment so a location-scoped list never
      // serves (or is served from) the clinic-wide entry.
      await h.service.findAll(Role.DOCTOR, 'clinic-1');
      await h.service.findAll(Role.DOCTOR, 'clinic-1', 'loc-1');
      await h.service.findAll();

      expect(h.cacheService.cache).toHaveBeenCalledWith(
        'users:all:DOCTOR:clinic-1:any-location',
        expect.any(Function),
        expect.objectContaining({ containsPHI: true })
      );
      expect(h.cacheService.cache).toHaveBeenCalledWith(
        'users:all:DOCTOR:clinic-1:loc-1',
        expect.any(Function),
        expect.objectContaining({ containsPHI: true })
      );
      expect(h.cacheService.cache).toHaveBeenCalledWith(
        'users:all:all:global:any-location',
        expect.any(Function),
        expect.any(Object)
      );
    });

    it('getDoctors lists doctors of the clinic', async () => {
      const h = createHarness();

      await h.service.getDoctors('clinic-1');

      expect(h.client.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role: Role.DOCTOR, clinics: { some: { id: 'clinic-1' } } },
        })
      );
    });
  });

  describe('findOne', () => {
    it('returns the user without the password', async () => {
      const h = createHarness();

      const result = await h.service.findOne('user-123', 'clinic-1');

      expect(result).toMatchObject({
        id: 'user-123',
        email: 'test@healthcare.com',
        patientId: 'patient-1',
        // A patient's password only counts once they set it themselves (passwordChangedAt).
        hasPassword: false,
      });
      expect(result).not.toHaveProperty('password');
    });

    it('throws userNotFound when the user does not exist', async () => {
      const h = createHarness({ user: null });

      await expect(h.service.findOne('nonexistent', 'clinic-1')).rejects.toThrow(
        'User nonexistent not found'
      );
      expect(h.errors.userNotFound).toHaveBeenCalledWith('nonexistent', 'UsersService.findOne');
    });

    it('hides a user of another clinic (tenant isolation)', async () => {
      const h = createHarness({ user: userRow({ primaryClinicId: 'clinic-2' }) });

      await expect(h.service.findOne('user-123', 'clinic-1')).rejects.toThrow(
        'User user-123 not found'
      );
    });

    it('creates the patient profile when a PATIENT has none yet', async () => {
      const h = createHarness({ user: userRow({ patient: null }) });
      h.client.patient.findUnique.mockResolvedValue({ id: 'patient-new' });

      const result = await h.service.findOne('user-123');

      expect(result.patientId).toBe('patient-new');
    });
  });

  describe('remove', () => {
    it('refuses without the delete permission', async () => {
      const h = createHarness({ hasPermission: false });

      await expect(h.service.remove('user-123', 'admin-123', 'clinic-1')).rejects.toThrow(
        'Insufficient permissions'
      );
      expect(h.databaseService.deleteUserSafe).not.toHaveBeenCalled();
    });

    it('throws when the user does not exist', async () => {
      const h = createHarness({ user: null });

      await expect(h.service.remove('nonexistent', 'admin-123', 'clinic-1')).rejects.toThrow(
        'User nonexistent not found'
      );
      expect(h.databaseService.deleteUserSafe).not.toHaveBeenCalled();
    });

    it('deletes the patient record and the user, invalidates the cache and emits user.deleted', async () => {
      const h = createHarness();

      await expect(h.service.remove('user-123', 'admin-123', 'clinic-1')).resolves.toBeUndefined();

      expect(h.rbacService.checkPermission).toHaveBeenCalledWith(
        expect.objectContaining({ resource: 'users', action: 'delete', resourceId: 'user-123' })
      );
      expect(h.client.patient.delete).toHaveBeenCalledWith({ where: { userId: 'user-123' } });
      expect(h.client.doctor.delete).not.toHaveBeenCalled();
      expect(h.databaseService.deleteUserSafe).toHaveBeenCalledWith('user-123');
      expect(h.cacheService.invalidateCacheByTag).toHaveBeenCalledWith('user:user-123');
      expect(h.eventService.emit).toHaveBeenCalledWith('user.deleted', { userId: 'user-123' });
    });

    it('deletes the doctor record for a doctor', async () => {
      const h = createHarness({ user: userRow({ role: Role.DOCTOR, doctor: { id: 'd-1' } }) });

      await h.service.remove('user-123');

      expect(h.client.doctor.delete).toHaveBeenCalledWith({ where: { userId: 'user-123' } });
      expect(h.client.patient.delete).not.toHaveBeenCalled();
      expect(h.rbacService.checkPermission).not.toHaveBeenCalled();
    });
  });
});
