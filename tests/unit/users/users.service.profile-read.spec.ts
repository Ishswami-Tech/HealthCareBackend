/// <reference types="jest" />
/**
 * Patient profile fields on the user profile routes (GET /users/me, GET /users/:id,
 * PATCH /users/:id, POST /profile/completion/update all end in UsersService):
 * the emergency contact is returned, occupation / marital status / blood group are saved
 * and returned, and the stored profile photo is returned as a presigned URL.
 */

import { UsersService } from '@services/users/users.service';

jest.mock('@infrastructure/database', () => ({ DatabaseService: class DatabaseService {} }));
jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));

const NOW = new Date('2026-03-01T00:00:00Z');

function userRow(over: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'asha@example.com',
    password: 'hash',
    firstName: 'Asha',
    lastName: 'Rao',
    role: 'PATIENT',
    isVerified: true,
    isProfileComplete: true,
    createdAt: NOW,
    updatedAt: NOW,
    phone: '+911234567890',
    dateOfBirth: null,
    occupation: 'Teacher',
    maritalStatus: 'MARRIED',
    bloodGroup: 'O+',
    profilePicture: 'https://cdn.example.com/documents/avatar-user-1-1.jpg',
    patient: { id: 'patient-1' },
    primaryClinicId: null,
    ...over,
  };
}

function createHarness(contact: Record<string, unknown> | null) {
  const client = {
    emergencyContact: { findFirst: jest.fn().mockResolvedValue(contact) },
    user: { findUnique: jest.fn().mockResolvedValue(userRow()) },
  };
  const databaseService = {
    findUserByIdSafe: jest.fn().mockResolvedValue(userRow()),
    findUserByIdSafeFresh: jest.fn().mockResolvedValue(userRow()),
    findUserByEmailSafe: jest.fn(),
    findUserByPhoneSafe: jest.fn().mockResolvedValue(null),
    updateUserSafe: jest.fn().mockResolvedValue(userRow()),
    executeHealthcareRead: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
    executeHealthcareWrite: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
  };
  const cacheService = {
    cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
    invalidateCache: jest.fn().mockResolvedValue(undefined),
    invalidateCacheByPattern: jest.fn().mockResolvedValue(undefined),
    invalidateCacheByTag: jest.fn().mockResolvedValue(undefined),
    invalidateDoctorCache: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };
  const eventService = {
    emit: jest.fn().mockResolvedValue(undefined),
    emitAsync: jest.fn(),
    emitEnterprise: jest.fn(),
    on: jest.fn(),
    onAny: jest.fn(),
  };
  const patientsService = {
    resolveProfilePhotoUrl: jest.fn(async (_id: string, url: string) => `${url}?signed=1`),
    ensurePatientProfile: jest.fn(),
  };
  const service = new UsersService(
    databaseService as never,
    cacheService as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    eventService as never,
    patientsService as never,
    {} as never,
    {} as never,
    {} as never
  );
  return { service, client, databaseService, patientsService };
}

describe('UsersService.findOne (profile read)', () => {
  it('returns the emergency contact, the new profile fields and a signed photo URL', async () => {
    const h = createHarness({
      name: 'Ravi',
      relationship: 'Spouse',
      phone: '+910000000000',
      alternatePhone: null,
      address: 'Pune',
    });

    const profile = await h.service.findOne('user-1');

    expect(profile).toMatchObject({
      id: 'user-1',
      occupation: 'Teacher',
      maritalStatus: 'MARRIED',
      bloodGroup: 'O+',
      emergencyContact: {
        name: 'Ravi',
        relationship: 'Spouse',
        phone: '+910000000000',
        address: 'Pune',
      },
      profilePicture: 'https://cdn.example.com/documents/avatar-user-1-1.jpg?signed=1',
    });
    expect(profile.emergencyContact).not.toHaveProperty('alternatePhone');
    expect(h.patientsService.resolveProfilePhotoUrl).toHaveBeenCalledWith(
      'user-1',
      'https://cdn.example.com/documents/avatar-user-1-1.jpg'
    );
    expect(profile).not.toHaveProperty('password');
  });

  it('only reads an active, non-deleted emergency contact of that user', async () => {
    const h = createHarness(null);

    const profile = await h.service.findOne('user-1');

    expect(h.client.emergencyContact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', isActive: true, deletedAt: null } })
    );
    expect(profile).not.toHaveProperty('emergencyContact');
  });
});

describe('UsersService.update (profile save)', () => {
  it('writes occupation, maritalStatus and bloodGroup and returns them with the emergency contact', async () => {
    const h = createHarness({
      name: 'Ravi',
      relationship: 'Spouse',
      phone: '+910000000000',
    });

    const result = await h.service.update('user-1', {
      occupation: 'Engineer',
      maritalStatus: 'SINGLE',
      bloodGroup: 'A-',
    });

    expect(h.databaseService.updateUserSafe).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        occupation: 'Engineer',
        maritalStatus: 'SINGLE',
        bloodGroup: 'A-',
      })
    );
    expect(result).toMatchObject({
      occupation: 'Teacher',
      maritalStatus: 'MARRIED',
      bloodGroup: 'O+',
      emergencyContact: { name: 'Ravi', relationship: 'Spouse', phone: '+910000000000' },
    });
  });
});
