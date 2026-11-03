/**
 * Unit tests for PatientsService.
 *
 * The service runs every query inside a `databaseService.executeHealthcareRead/Write`
 * callback, so the harness executes those callbacks against a fake Prisma client and
 * the tests assert on the client calls (what was queried / written) and the result.
 */

import { ForbiddenException } from '@nestjs/common';
import { PatientsService } from '@services/patients/patients.service';

type MockFn = jest.Mock;

interface FakeClient {
  patient: { findFirst: MockFn; findUnique: MockFn; findMany: MockFn; create: MockFn };
  user: { findUnique: MockFn; findMany: MockFn; update: MockFn };
  appointment: { findFirst: MockFn; findMany: MockFn };
  doctor: { findUnique: MockFn };
  insurance: { findFirst: MockFn; findMany: MockFn; create: MockFn; update: MockFn };
  emergencyContact: { findFirst: MockFn; create: MockFn; update: MockFn };
}

function makeClient(): FakeClient {
  return {
    patient: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'patient-new' }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: 'user-123' }),
    },
    appointment: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    doctor: { findUnique: jest.fn().mockResolvedValue(null) },
    insurance: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'ins-1' }),
      update: jest.fn().mockResolvedValue({ id: 'ins-1' }),
    },
    emergencyContact: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'ec-1' }),
      update: jest.fn().mockResolvedValue({ id: 'ec-1' }),
    },
  };
}

function createHarness() {
  const client = makeClient();
  const databaseService = {
    executeHealthcareRead: jest.fn((fn: (c: FakeClient) => Promise<unknown>) => fn(client)),
    executeHealthcareWrite: jest.fn((fn: (c: FakeClient) => Promise<unknown>) => fn(client)),
    findUserByIdSafe: jest.fn().mockResolvedValue(null),
    getClinicPatients: jest.fn(),
  };
  const loggingService = { log: jest.fn(), logError: jest.fn() };
  const staticAssetService = {
    resolveSignedUrl: jest.fn((url: string) => Promise.resolve(url)),
    uploadFile: jest.fn(),
  };
  const cacheService = {
    cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
    invalidatePatientCache: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const service = new PatientsService(
    databaseService as never,
    loggingService as never,
    staticAssetService as never,
    cacheService as never
  );

  return { service, client, databaseService, cacheService, staticAssetService };
}

const mockUser = {
  id: 'user-123',
  email: 'john@example.com',
  firstName: 'John',
  lastName: 'Doe',
  phone: '+919876543210',
  primaryClinicId: 'clinic-1',
};

const mockPatient = { id: 'patient-1', userId: 'user-123', user: mockUser };

describe('PatientsService', () => {
  describe('ensurePatientProfile', () => {
    it('creates the patient row when none exists and invalidates the cached profile', async () => {
      const { service, client, databaseService, cacheService } = createHarness();
      databaseService.findUserByIdSafe.mockResolvedValue(mockUser);

      await service.ensurePatientProfile('user-123', 'clinic-1');

      expect(client.patient.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-123', user: { primaryClinicId: 'clinic-1' } },
      });
      expect(client.patient.create).toHaveBeenCalledWith({ data: { userId: 'user-123' } });
      expect(cacheService.invalidatePatientCache).toHaveBeenCalledWith('user-123');
    });

    it('does not create a second row when the patient already exists', async () => {
      const { service, client, cacheService } = createHarness();
      client.patient.findFirst.mockResolvedValue(mockPatient);

      await service.ensurePatientProfile('user-123', 'clinic-1');

      expect(client.patient.create).not.toHaveBeenCalled();
      expect(cacheService.invalidatePatientCache).not.toHaveBeenCalled();
    });

    it("falls back to the user's primary clinic when no clinic is given", async () => {
      const { service, client, databaseService } = createHarness();
      databaseService.findUserByIdSafe.mockResolvedValue(mockUser);
      client.patient.findFirst.mockResolvedValue(mockPatient);

      await service.ensurePatientProfile('user-123');

      expect(client.patient.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-123', user: { primaryClinicId: 'clinic-1' } },
      });
    });
  });

  describe('createOrUpdatePatient', () => {
    it('creates the patient and writes the demographics onto the user', async () => {
      const { service, client, databaseService, cacheService } = createHarness();
      databaseService.findUserByIdSafe.mockResolvedValue(mockUser);

      const result = await service.createOrUpdatePatient({
        userId: 'user-123',
        clinicId: 'clinic-1',
        gender: 'MALE',
        bloodGroup: ' A+ ',
        address: '123 Main St',
      });

      expect(result).toEqual({ success: true, message: 'Patient profile updated' });
      expect(client.patient.create).toHaveBeenCalled();
      expect(client.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { gender: 'MALE', bloodGroup: 'A+', address: '123 Main St' },
      });
      expect(cacheService.invalidatePatientCache).toHaveBeenCalledWith('user-123', 'clinic-1');
    });

    it('updates the existing insurance and emergency contact instead of adding new ones', async () => {
      const { service, client, databaseService } = createHarness();
      databaseService.findUserByIdSafe.mockResolvedValue(mockUser);
      client.patient.findFirst.mockResolvedValue(mockPatient);
      client.insurance.findFirst.mockResolvedValue({ id: 'ins-1' });
      client.emergencyContact.findFirst.mockResolvedValue({ id: 'ec-1' });

      await service.createOrUpdatePatient({
        userId: 'user-123',
        clinicId: 'clinic-1',
        insurance: {
          provider: 'HealthCorp',
          policyNumber: 'POL-1',
          primaryHolder: 'John Doe',
          coverageStartDate: '2026-01-01',
          coverageType: 'FAMILY',
        },
        emergencyContact: { name: 'Jane', relationship: 'Spouse', phone: '9876543210' },
      });

      expect(client.patient.create).not.toHaveBeenCalled();
      expect(client.insurance.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ins-1' } })
      );
      expect(client.insurance.create).not.toHaveBeenCalled();
      expect(client.emergencyContact.update).toHaveBeenCalledWith({
        where: { id: 'ec-1' },
        data: { name: 'Jane', relationship: 'Spouse', phone: '9876543210' },
      });
      expect(client.emergencyContact.create).not.toHaveBeenCalled();
    });

    it('rejects a clinic-scoped save for an unknown user', async () => {
      const { service, client } = createHarness();

      await expect(
        service.createOrUpdatePatient({ userId: 'nobody', clinicId: 'clinic-1' })
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(client.patient.create).not.toHaveBeenCalled();
    });

    it('rejects a save into a clinic the user does not belong to', async () => {
      const { service, databaseService, client } = createHarness();
      databaseService.findUserByIdSafe.mockResolvedValue(mockUser);

      await expect(
        service.createOrUpdatePatient({ userId: 'user-123', clinicId: 'clinic-2' })
      ).rejects.toThrow('User does not belong to this clinic');
      expect(client.user.update).not.toHaveBeenCalled();
    });
  });

  describe('updatePatient', () => {
    it('delegates to createOrUpdatePatient with the id as the userId', async () => {
      const { service, client } = createHarness();
      client.patient.findFirst.mockResolvedValue(mockPatient);

      const result = await service.updatePatient('user-123', { occupation: 'Engineer' });

      expect(result).toEqual({ success: true, message: 'Patient profile updated' });
      expect(client.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { occupation: 'Engineer' },
      });
    });
  });

  describe('getPatientProfile', () => {
    it('returns the user with the primary emergency contact flattened', async () => {
      const { service, client } = createHarness();
      const contact = { id: 'ec-1', name: 'Jane' };
      client.user.findUnique.mockResolvedValue({ ...mockUser, emergencyContacts: [contact] });

      const result = (await service.getPatientProfile('user-123')) as Record<string, unknown>;

      expect(result['id']).toBe('user-123');
      expect(result['emergencyContact']).toEqual(contact);
      const args = client.user.findUnique.mock.calls[0][0] as { omit: Record<string, boolean> };
      expect(args.omit).toEqual(expect.objectContaining({ password: true }));
    });

    it('returns null for an unknown user', async () => {
      const { service } = createHarness();

      await expect(service.getPatientProfile('nonexistent')).resolves.toBeNull();
    });
  });

  describe('getClinicPatients', () => {
    it('returns the patients with appointments or a link to the clinic, deduplicated', async () => {
      const { service, client } = createHarness();
      client.appointment.findMany.mockResolvedValue([{ patientId: 'patient-1' }]);
      client.user.findMany.mockResolvedValue([
        { patient: { id: 'patient-1' } },
        { patient: { id: 'patient-2' } },
        { patient: null },
      ]);
      client.patient.findMany.mockResolvedValue([mockPatient]);

      const result = await service.getClinicPatients('clinic-1');

      expect(result).toEqual([mockPatient]);
      expect(client.patient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['patient-1', 'patient-2'] } } })
      );
    });

    it('filters the list by name', async () => {
      const { service, client } = createHarness();
      client.appointment.findMany.mockResolvedValue([{ patientId: 'patient-1' }]);
      client.patient.findMany.mockResolvedValue([
        mockPatient,
        { id: 'patient-2', userId: 'u2', user: { firstName: 'Asha', lastName: 'Rao' } },
      ]);

      const result = await service.getClinicPatients('clinic-1', 'john');

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(mockPatient);
    });

    it('returns an empty list without loading patients when none are linked', async () => {
      const { service, client } = createHarness();

      await expect(service.getClinicPatients('clinic-1')).resolves.toEqual([]);
      expect(client.patient.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getClinicPatientsPaginated', () => {
    it('delegates the clinic-wide list to the database pagination query', async () => {
      const { service, databaseService } = createHarness();
      const page = { patients: [mockPatient], total: 1, page: 1, totalPages: 1 };
      databaseService.getClinicPatients.mockResolvedValue(page);

      const result = await service.getClinicPatientsPaginated('clinic-1', {
        page: 1,
        limit: 10,
        searchTerm: '  John ',
      });

      expect(result).toBe(page);
      expect(databaseService.getClinicPatients).toHaveBeenCalledWith('clinic-1', {
        page: 1,
        limit: 10,
        searchTerm: 'John',
      });
    });

    it("pages a doctor's own patients in memory", async () => {
      const { service, client, databaseService } = createHarness();
      client.doctor.findUnique.mockResolvedValue({ id: 'doctor-1' });
      client.appointment.findMany.mockResolvedValue([
        { patientId: 'p1' },
        { patientId: 'p2' },
        { patientId: 'p3' },
      ]);
      client.patient.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);

      const result = await service.getClinicPatientsPaginated(
        'clinic-1',
        { page: 2, limit: 2 },
        'doctor-user-1'
      );

      expect(databaseService.getClinicPatients).not.toHaveBeenCalled();
      expect(client.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { clinicId: 'clinic-1', doctorId: 'doctor-1' } })
      );
      expect(result).toEqual({ patients: [{ id: 'p3' }], total: 3, page: 2, totalPages: 2 });
    });
  });

  describe('isPatientInClinic', () => {
    it('is true for a patient whose primary clinic is the clinic', async () => {
      const { service, client } = createHarness();
      client.user.findUnique.mockResolvedValue({ primaryClinicId: 'clinic-1' });

      await expect(service.isPatientInClinic('user-123', 'clinic-1')).resolves.toBe(true);
    });

    it('is true for a patient with an appointment at the clinic', async () => {
      const { service, client } = createHarness();
      client.user.findUnique.mockResolvedValue({ primaryClinicId: 'clinic-2' });
      client.patient.findUnique.mockResolvedValue({ id: 'patient-1' });
      client.appointment.findFirst.mockResolvedValue({ id: 'appt-1' });

      await expect(service.isPatientInClinic('user-123', 'clinic-1')).resolves.toBe(true);
      expect(client.appointment.findFirst).toHaveBeenCalledWith({
        where: { patientId: 'patient-1', clinicId: 'clinic-1' },
      });
    });

    it('is false for an unknown user or a patient with no link to the clinic', async () => {
      const { service, client } = createHarness();
      await expect(service.isPatientInClinic('user-999', 'clinic-1')).resolves.toBe(false);

      client.user.findUnique.mockResolvedValue({ primaryClinicId: 'clinic-2' });
      client.patient.findUnique.mockResolvedValue({ id: 'patient-1' });
      await expect(service.isPatientInClinic('user-123', 'clinic-1')).resolves.toBe(false);
    });
  });

  describe('deletePatient', () => {
    it('soft-deletes by deactivating the user account', async () => {
      const { service, client, databaseService } = createHarness();
      databaseService.findUserByIdSafe.mockResolvedValue(mockUser);

      await service.deletePatient('user-123', 'clinic-1');

      expect(client.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { isActive: false },
      });
      expect(databaseService.executeHealthcareWrite).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ operation: 'DELETE', resourceId: 'user-123' })
      );
    });
  });

  describe('getInsurance', () => {
    it("returns the patient's insurance policies, newest first", async () => {
      const { service, client } = createHarness();
      const policy = { id: 'ins-1', userId: 'user-123', provider: 'HealthCorp' };
      client.insurance.findMany.mockResolvedValue([policy]);

      const result = await service.getInsurance('user-123');

      expect(result).toEqual([policy]);
      expect(client.insurance.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
