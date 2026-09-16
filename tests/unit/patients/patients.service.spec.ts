/**
 * Unit tests for PatientsService.
 */

import { PatientsService } from '@services/patients/patients.service';
import { Role } from '@core/types/enums.types';

describe('PatientsService', () => {
  function createService(overrides: {
    databaseService?: Record<string, jest.Mock>;
    loggingService?: Record<string, jest.Mock>;
    staticAssetService?: Record<string, jest.Mock>;
    cacheService?: Record<string, jest.Mock>;
    appointmentsService?: Record<string, jest.Mock>;
    ehrService?: Record<string, jest.Mock>;
    billingService?: Record<string, jest.Mock>;
    pharmacyService?: Record<string, jest.Mock>;
  } = {}) {
    const databaseService = overrides.databaseService || {
      executeHealthcareRead: jest.fn(),
      executeHealthcareWrite: jest.fn(),
      executeHealthcareWriteTransaction: jest.fn(),
      findUserByIdSafe: jest.fn(),
      findClinicByIdSafe: jest.fn(),
      findClinicPatient: jest.fn(),
    };

    const loggingService = overrides.loggingService || {
      log: jest.fn(),
      logError: jest.fn(),
    };

    const staticAssetService = overrides.staticAssetService || {
      upload: jest.fn(),
      getUrl: jest.fn(),
    };

    const cacheService = overrides.cacheService || {
      cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const appointmentsService = overrides.appointmentsService || {};
    const ehrService = overrides.ehrService || {};
    const billingService = overrides.billingService || {};
    const pharmacyService = overrides.pharmacyService || {};

    return new PatientsService(
      databaseService as any,
      loggingService as any,
      staticAssetService as any,
      cacheService as any,
      appointmentsService as any,
      ehrService as any,
      billingService as any,
      pharmacyService as any,
    );
  }

  const mockPatient = {
    id: 'patient-1',
    userId: 'user-123',
    clinicId: 'clinic-1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phone: '+919876543210',
    dateOfBirth: new Date('1990-01-01'),
    gender: 'male',
    address: '123 Main St',
    bloodGroup: 'A+',
    emergencyContact: '9876543210',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-09-01'),
  };

  describe('ensurePatientProfile', () => {
    it('should create patient profile if it does not exist', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue(null),
        executeHealthcareWrite: jest.fn().mockResolvedValue(mockPatient),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn().mockResolvedValue({
          id: 'user-123',
          email: 'john@example.com',
          firstName: 'John',
          lastName: 'Doe',
          role: Role.PATIENT,
        }),
        findClinicByIdSafe: jest.fn().mockResolvedValue({ id: 'clinic-1', isActive: true }),
        findClinicPatient: jest.fn().mockResolvedValue(null),
      };

      const service = createService({ databaseService });
      const result = await (service as any).ensurePatientProfile('user-123', 'clinic-1');

      expect(result).toBeDefined();
    });

    it('should return existing patient profile if found', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue(mockPatient),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
        findClinicByIdSafe: jest.fn(),
        findClinicPatient: jest.fn().mockResolvedValue(mockPatient),
      };

      const service = createService({ databaseService });
      const result = await (service as any).ensurePatientProfile('user-123', 'clinic-1');

      expect(result).toBeDefined();
      expect(result.id).toBe('patient-1');
    });
  });

  describe('createOrUpdatePatient', () => {
    it('should create a new patient record', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue(null),
        executeHealthcareWrite: jest.fn().mockResolvedValue(mockPatient),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn().mockResolvedValue({
          id: 'user-123',
          email: 'john@example.com',
        }),
        findClinicByIdSafe: jest.fn().mockResolvedValue({ id: 'clinic-1', isActive: true }),
        findClinicPatient: jest.fn().mockResolvedValue(null),
      };

      const service = createService({ databaseService });
      const result = await (service as any).createOrUpdatePatient({
        userId: 'user-123',
        clinicId: 'clinic-1',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('patient-1');
    });

    it('should update existing patient', async () => {
      const updatedPatient = { ...mockPatient, phone: '+919912345678' };
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue(mockPatient),
        executeHealthcareWrite: jest.fn().mockResolvedValue(updatedPatient),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
        findClinicByIdSafe: jest.fn(),
        findClinicPatient: jest.fn().mockResolvedValue(mockPatient),
      };

      const service = createService({ databaseService });
      const result = await (service as any).createOrUpdatePatient({
        userId: 'user-123',
        clinicId: 'clinic-1',
        phone: '+919912345678',
      });

      expect(result.phone).toBe('+919912345678');
    });
  });

  describe('getPatientProfile', () => {
    it('should return patient profile', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue(mockPatient),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
        findClinicByIdSafe: jest.fn(),
        findClinicPatient: jest.fn(),
      };

      const service = createService({ databaseService });
      const result = await (service as any).getPatientProfile('patient-1', 'clinic-1');

      expect(result).toBeDefined();
      expect(result.id).toBe('patient-1');
    });

    it('should throw when patient not found', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue(null),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
        findClinicByIdSafe: jest.fn(),
        findClinicPatient: jest.fn().mockResolvedValue(null),
      };

      const service = createService({ databaseService });

      await expect(
        (service as any).getPatientProfile('nonexistent', 'clinic-1')
      ).rejects.toThrow();
    });
  });

  describe('getClinicPatients', () => {
    it('should return all patients in a clinic', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue([mockPatient]),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
        findClinicByIdSafe: jest.fn(),
        findClinicPatient: jest.fn(),
      };

      const service = createService({ databaseService });
      const result = await (service as any).getClinicPatients('clinic-1');

      expect(result).toEqual([mockPatient]);
    });

    it('should search patients by name', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue([mockPatient]),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
        findClinicByIdSafe: jest.fn(),
        findClinicPatient: jest.fn(),
      };

      const service = createService({ databaseService });
      const result = await (service as any).getClinicPatients('clinic-1', 'John');

      expect(result).toHaveLength(1);
      expect(result[0].firstName).toBe('John');
    });
  });

  describe('getClinicPatientsPaginated', () => {
    it('should return paginated patient list', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue({
          patients: [mockPatient],
          total: 1,
          page: 1,
          limit: 10,
        }),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
        findClinicByIdSafe: jest.fn(),
        findClinicPatient: jest.fn(),
      };

      const service = createService({ databaseService });
      const result = await (service as any).getClinicPatientsPaginated('clinic-1', {
        page: 1,
        limit: 10,
      });

      expect(result.patients).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('isPatientInClinic', () => {
    it('should return true when patient is in clinic', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue(mockPatient),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
        findClinicByIdSafe: jest.fn(),
        findClinicPatient: jest.fn().mockResolvedValue(mockPatient),
      };

      const service = createService({ databaseService });
      const result = await (service as any).isPatientInClinic('user-123', 'clinic-1');

      expect(result).toBe(true);
    });

    it('should return false when patient is not in clinic', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue(null),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
        findClinicByIdSafe: jest.fn(),
        findClinicPatient: jest.fn().mockResolvedValue(null),
      };

      const service = createService({ databaseService });
      const result = await (service as any).isPatientInClinic('user-999', 'clinic-1');

      expect(result).toBe(false);
    });
  });

  describe('updatePatient', () => {
    it('should update patient fields', async () => {
      const updatedPatient = { ...mockPatient, phone: '+919912345678' };
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue(mockPatient),
        executeHealthcareWrite: jest.fn().mockResolvedValue(updatedPatient),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
        findClinicByIdSafe: jest.fn(),
        findClinicPatient: jest.fn().mockResolvedValue(mockPatient),
      };

      const service = createService({ databaseService });
      const result = await (service as any).updatePatient('patient-1', {
        phone: '+919912345678',
      });

      expect(result.phone).toBe('+919912345678');
    });
  });

  describe('deletePatient', () => {
    it('should delete patient record', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue(mockPatient),
        executeHealthcareWrite: jest.fn().mockResolvedValue({ count: 1 }),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
        findClinicByIdSafe: jest.fn(),
        findClinicPatient: jest.fn().mockResolvedValue(mockPatient),
      };

      const service = createService({ databaseService });
      await expect(
        (service as any).deletePatient('user-123', 'clinic-1')
      ).resolves.toBeUndefined();

      expect(databaseService.executeHealthcareWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'patient-1' },
        }),
      );
    });
  });

  describe('getInsurance', () => {
    it('should return patient insurance info', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue({
          id: 'ins-1',
          patientId: 'patient-1',
          provider: 'HealthCorp',
          policyNumber: 'POL-12345',
          coverageAmount: 100000,
        }),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
        findClinicByIdSafe: jest.fn(),
        findClinicPatient: jest.fn(),
      };

      const service = createService({ databaseService });
      const result = await (service as any).getInsurance('patient-1', 'clinic-1');

      expect(result).toBeDefined();
      expect(result.provider).toBe('HealthCorp');
    });
  });

  describe('clinic isolation', () => {
    it('should filter patients by clinic', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue([]),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findUserByIdSafe: jest.fn(),
        findClinicByIdSafe: jest.fn().mockResolvedValue({ id: 'clinic-1', isActive: true }),
        findClinicPatient: jest.fn(),
      };

      const service = createService({ databaseService });
      await (service as any).getClinicPatients('clinic-1');

      expect(databaseService.executeHealthcareRead).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ clinicId: 'clinic-1' }),
        }),
      );
    });
  });
});
