/**
 * Unit tests for UsersService.
 */

import { UsersService } from '@services/users/users.service';
import { Role } from '@core/types/enums.types';
import type { UserResponseDto } from '@dtos/user.dto';
import { CreateUserDto, UpdateUserDto } from '@dtos/user.dto';

describe('UsersService', () => {
  function createService(overrides: {
    db?: Record<string, jest.Mock>;
    cache?: Record<string, jest.Mock>;
    logging?: Record<string, jest.Mock>;
    event?: Record<string, jest.Mock>;
    patients?: Record<string, jest.Mock>;
    rbac?: Record<string, jest.Mock>;
    auth?: Record<string, jest.Mock>;
    errors?: Record<string, jest.Mock>;
  } = {}) {
    const db = overrides.db || {
      executeHealthcareRead: jest.fn(),
      executeHealthcareWrite: jest.fn(),
      executeHealthcareWriteTransaction: jest.fn(),
      findUserByIdSafe: jest.fn(),
    };

    const cache = overrides.cache || {
      cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const logging = overrides.logging || { log: jest.fn() };
    const event = overrides.event || { emit: jest.fn() };
    const patients = overrides.patients || {
      findById: jest.fn(),
      createPatient: jest.fn(),
    };
    const rbac = overrides.rbac || {
      checkPermission: jest.fn().mockResolvedValue(true),
    };
    const auth = overrides.auth || { register: jest.fn(), logout: jest.fn() };
    const errors = overrides.errors || {
      userNotFound: jest.fn((id: string) => new Error(`User ${id} not found`)),
      validationError: jest.fn(() => new Error('Validation error')),
      clinicNotFound: jest.fn(() => new Error('Clinic not found')),
    };

    return new UsersService(
      db as any,
      cache as any,
      logging as any,
      event as any,
      patients as any,
      rbac as any,
      auth as any,
      errors as any,
    );
  }

  const testUser: UserResponseDto = {
    id: 'user-123',
    email: 'test@healthcare.com',
    firstName: 'Test',
    lastName: 'User',
    role: Role.PATIENT,
    phone: '+919876543210',
    phoneVerified: true,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-09-01'),
  };

  describe('findAll', () => {
    it('should return users with optional role filter', async () => {
      const db = {
        executeHealthcareRead: jest.fn().mockResolvedValue([testUser]),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
      };
      const cache = {
        cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
      };

      const service = createService({ db, cache });
      const result = await (service as any).findAll(undefined, 'clinic-1');

      expect(result).toEqual([testUser]);
      expect(db.executeHealthcareRead).toHaveBeenCalled();
    });

    it('should filter by role when provided', async () => {
      const db = {
        executeHealthcareRead: jest.fn().mockResolvedValue([testUser]),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
      };
      const cache = {
        cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
      };

      const service = createService({ db, cache });
      await (service as any).findAll(Role.DOCTOR, 'clinic-1');

      expect(db.executeHealthcareRead).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: Role.DOCTOR }),
        }),
      );
    });

    it('should not filter by clinic when clinicId is not provided', async () => {
      const db = {
        executeHealthcareRead: jest.fn().mockResolvedValue([testUser]),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
      };
      const cache = {
        cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
      };

      const service = createService({ db, cache });
      await (service as any).findAll(Role.PATIENT);

      expect(db.executeHealthcareRead).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ clinics: expect.anything() }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return a user by id', async () => {
      const db = {
        executeHealthcareRead: jest.fn(),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn().mockResolvedValue(testUser),
      };
      const cache = {
        cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
      };

      const service = createService({ db, cache });
      const result = await (service as any).findOne('user-123', 'clinic-1');

      expect(result).toBeDefined();
      expect(result.email).toBe('test@healthcare.com');
    });

    it('should throw when user not found', async () => {
      const errors = {
        userNotFound: jest.fn((id: string) => { throw new Error(`User ${id} not found`); }),
        validationError: jest.fn(() => new Error('Validation error')),
        clinicNotFound: jest.fn(() => new Error('Clinic not found')),
      };
      const db = {
        executeHealthcareRead: jest.fn(),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn().mockResolvedValue(null),
      };
      const cache = {
        cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
      };

      const service = createService({ db, cache, errors });

      await expect(
        (service as any).findOne('nonexistent', 'clinic-1')
      ).rejects.toThrow();
    });

    it('should never expose password in response', async () => {
      const userWithPassword = { ...testUser, password: '$2b$12$secret' };
      const db = {
        executeHealthcareRead: jest.fn(),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn().mockResolvedValue(userWithPassword),
      };
      const cache = {
        cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
      };

      const service = createService({ db, cache });
      const result = await (service as any).findOne('user-123', 'clinic-1');

      expect(result).not.toHaveProperty('password');
    });
  });

  describe('createUser', () => {
    it('should create a new user', async () => {
      const newUser = { ...testUser, id: 'user-new' };
      const db = {
        executeHealthcareRead: jest.fn().mockResolvedValue(newUser),
        executeHealthcareWrite: jest.fn().mockResolvedValue(newUser),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
      };
      const cache = {
        cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
      };
      const auth = {
        register: jest.fn().mockResolvedValue({ success: true, user: newUser }),
        logout: jest.fn(),
      };

      const service = createService({ db, cache, auth });
      const result = await (service as any).createUser({
        email: 'new@example.com',
        password: 'SecurePass123!',
        firstName: 'New',
        lastName: 'User',
        role: Role.PATIENT,
        clinicId: 'clinic-1',
      } as CreateUserDto);

      expect(result).toBeDefined();
      expect(result.email).toBe('new@example.com');
    });
  });

  describe('update', () => {
    it('should update user fields', async () => {
      const updatedUser = { ...testUser, firstName: 'Updated' };
      const db = {
        executeHealthcareRead: jest.fn().mockResolvedValue(updatedUser),
        executeHealthcareWrite: jest.fn().mockResolvedValue(updatedUser),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
      };
      const cache = {
        cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
      };

      const service = createService({ db, cache });
      const result = await (service as any).update('user-123', { firstName: 'Updated' } as UpdateUserDto, 'user-123', 'clinic-1');

      expect(result.firstName).toBe('Updated');
    });
  });

  describe('remove', () => {
    it('should delete a user', async () => {
      const db = {
        executeHealthcareRead: jest.fn(),
        executeHealthcareWrite: jest.fn().mockResolvedValue({ count: 1 }),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn().mockResolvedValue(null),
      };
      const cache = {
        cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
      };

      const service = createService({ db, cache });
      await expect(
        (service as any).remove('user-123', 'admin-123', 'clinic-1')
      ).resolves.toBeUndefined();

      expect(db.executeHealthcareWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-123' },
        }),
      );
    });

    it('should throw when deleting non-existent user', async () => {
      const db = {
        executeHealthcareRead: jest.fn(),
        executeHealthcareWrite: jest.fn().mockResolvedValue({ count: 0 }),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn().mockResolvedValue(null),
      };
      const cache = {
        cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
      };
      const errors = {
        userNotFound: jest.fn((id: string) => { throw new Error(`User ${id} not found`); }),
        validationError: jest.fn(() => new Error('Validation error')),
        clinicNotFound: jest.fn(() => new Error('Clinic not found')),
      };

      const service = createService({ db, cache, errors });

      await expect(
        (service as any).remove('nonexistent', 'admin-123', 'clinic-1')
      ).rejects.toThrow();
    });
  });

  describe('role-based access', () => {
    it('should allow admin to get any user', async () => {
      const db = {
        executeHealthcareRead: jest.fn(),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn().mockResolvedValue(testUser),
      };
      const cache = {
        cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
      };
      const rbac = {
        checkPermission: jest.fn().mockResolvedValue(true),
      };

      const service = createService({ db, cache, rbac });
      const result = await (service as any).findOne('user-123', 'clinic-1');

      expect(result).toBeDefined();
    });

    it('should restrict non-admin from accessing other users', async () => {
      const rbac = {
        checkPermission: jest.fn().mockResolvedValue(false),
      };

      const service = createService({ rbac });

      await expect(
        (service as any).findOne('other-user', 'clinic-1', 'user-123')
      ).rejects.toThrow();
    });
  });

  describe('clinic isolation', () => {
    it('should filter doctors by clinic', async () => {
      const db = {
        executeHealthcareRead: jest.fn().mockResolvedValue([testUser]),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
      };
      const cache = {
        cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
      };

      const service = createService({ db, cache });
      await (service as any).findAll(Role.DOCTOR, 'clinic-1');

      expect(db.executeHealthcareRead).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: Role.DOCTOR }),
        }),
      );
    });
  });
});
