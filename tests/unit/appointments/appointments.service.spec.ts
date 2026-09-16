/**
 * Unit tests for AppointmentsService.
 *
 * AppointmentsService has ~20 constructor dependencies. These tests
 * provide plain mock objects for each dependency so the service can be
 * instantiated and its public methods tested in isolation.
 */

import { AppointmentsService } from '@services/appointments/appointments.service';
import { Role } from '@core/types/enums.types';

describe('AppointmentsService', () => {
  function createService(overrides: {
    coreAppointmentService?: Record<string, jest.Mock>;
    conflictResolutionService?: Record<string, jest.Mock>;
    workflowEngine?: Record<string, jest.Mock>;
    businessRules?: Record<string, jest.Mock>;
    pluginRegistry?: Record<string, jest.Mock>;
    pluginManager?: Record<string, jest.Mock>;
    clinicCheckInPlugin?: Record<string, jest.Mock>;
    checkInService?: Record<string, jest.Mock>;
    clinicNotificationPlugin?: Record<string, jest.Mock>;
    clinicConfirmationPlugin?: Record<string, jest.Mock>;
    clinicLocationPlugin?: Record<string, jest.Mock>;
    clinicFollowUpPlugin?: Record<string, jest.Mock>;
    appointmentReminderService?: Record<string, jest.Mock>;
    clinicVideoPlugin?: Record<string, jest.Mock>;
    loggingService?: Record<string, jest.Mock>;
    cacheService?: Record<string, jest.Mock>;
    queueService?: Record<string, jest.Mock>;
    appointmentQueueService?: Record<string, jest.Mock>;
    eventService?: Record<string, jest.Mock>;
    configService?: Record<string, jest.Mock>;
    databaseService?: Record<string, jest.Mock>;
    qrService?: Record<string, jest.Mock>;
    authService?: Record<string, jest.Mock>;
    whatsAppService?: Record<string, jest.Mock>;
    notificationPreferenceService?: Record<string, jest.Mock>;
    errors?: Record<string, jest.Mock>;
    rbacService?: Record<string, jest.Mock>;
    billingService?: Record<string, jest.Mock>;
  } = {}) {
    const coreAppointmentService = overrides.coreAppointmentService || {
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      updateStatus: jest.fn(),
      cancel: jest.fn(),
      reschedule: jest.fn(),
    };

    const conflictResolutionService = overrides.conflictResolutionService || {
      detectConflicts: jest.fn().mockResolvedValue([]),
    };

    const workflowEngine = overrides.workflowEngine || {
      run: jest.fn(),
    };

    const businessRules = overrides.businessRules || {
      validate: jest.fn().mockResolvedValue({ valid: true }),
    };

    const pluginRegistry = overrides.pluginRegistry || {
      getPlugin: jest.fn(),
      register: jest.fn(),
    };

    const pluginManager = overrides.pluginManager || {
      execute: jest.fn(),
    };

    const clinicCheckInPlugin = overrides.clinicCheckInPlugin || {
      checkIn: jest.fn(),
      undoCheckIn: jest.fn(),
    };

    const checkInService = overrides.checkInService || {
      processCheckIn: jest.fn(),
    };

    const clinicNotificationPlugin = overrides.clinicNotificationPlugin || {
      notify: jest.fn(),
    };

    const clinicConfirmationPlugin = overrides.clinicConfirmationPlugin || {
      confirm: jest.fn(),
    };

    const clinicLocationPlugin = overrides.clinicLocationPlugin || {
      getInfo: jest.fn(),
    };

    const clinicFollowUpPlugin = overrides.clinicFollowUpPlugin || {
      createPlan: jest.fn(),
    };

    const appointmentReminderService = overrides.appointmentReminderService || {
      scheduleReminder: jest.fn(),
    };

    const clinicVideoPlugin = overrides.clinicVideoPlugin || {
      scheduleVideo: jest.fn(),
    };

    const loggingService = overrides.loggingService || {
      log: jest.fn(),
      logError: jest.fn(),
      logSecurity: jest.fn(),
    };

    const cacheService = overrides.cacheService || {
      cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      getString: jest.fn(),
      setString: jest.fn(),
    };

    const queueService = overrides.queueService || {
      enqueue: jest.fn(),
    };

    const appointmentQueueService = overrides.appointmentQueueService || {
      enqueue: jest.fn(),
    };

    const eventService = overrides.eventService || {
      emit: jest.fn(),
    };

    const configService = overrides.configService || {
      get: jest.fn(),
    };

    const databaseService = overrides.databaseService || {
      executeHealthcareRead: jest.fn(),
      executeHealthcareWrite: jest.fn(),
      executeHealthcareWriteTransaction: jest.fn(),
      findClinicByIdSafe: jest.fn(),
    };

    const qrService = overrides.qrService || {
      generate: jest.fn(),
    };

    const authService = overrides.authService || {
      getUserPermissions: jest.fn().mockResolvedValue([]),
    };

    const whatsAppService = overrides.whatsAppService || {
      sendMessage: jest.fn(),
    };

    const notificationPreferenceService = overrides.notificationPreferenceService || {
      getUserPreferences: jest.fn(),
    };

    const errors = overrides.errors || {
      validationError: jest.fn(() => new Error('Validation error')),
      clinicNotFound: jest.fn(() => new Error('Clinic not found')),
      userNotFound: jest.fn(() => new Error('User not found')),
      appointmentNotFound: jest.fn(() => new Error('Appointment not found')),
    };

    const rbacService = overrides.rbacService || {
      checkPermission: jest.fn().mockResolvedValue(true),
    };

    const billingService = overrides.billingService || {
      syncAppointmentBilling: jest.fn(),
      triggerRefund: jest.fn(),
    };

    return new AppointmentsService(
      coreAppointmentService as any,
      conflictResolutionService as any,
      workflowEngine as any,
      businessRules as any,
      pluginRegistry as any,
      pluginManager as any,
      clinicCheckInPlugin as any,
      checkInService as any,
      clinicNotificationPlugin as any,
      clinicConfirmationPlugin as any,
      clinicLocationPlugin as any,
      clinicFollowUpPlugin as any,
      appointmentReminderService as any,
      clinicVideoPlugin as any,
      loggingService as any,
      cacheService as any,
      queueService as any,
      appointmentQueueService as any,
      eventService as any,
      configService as any,
      databaseService as any,
      qrService as any,
      authService as any,
      whatsAppService as any,
      notificationPreferenceService as any,
      errors as any,
      rbacService as any,
      billingService as any,
    );
  }

  describe('constructor', () => {
    it('should accept all required dependencies', () => {
      const service = createService();
      expect(service).toBeDefined();
    });
  });

  describe('createAppointment', () => {
    it('should create a new appointment', async () => {
      const coreAppointmentService = {
        create: jest.fn().mockResolvedValue({
          id: 'apt-123',
          patientUserId: 'patient-1',
          doctorUserId: 'doctor-1',
          clinicId: 'clinic-1',
          appointmentType: 'IN_PERSON',
          status: 'SCHEDULED',
          startTime: new Date('2026-10-01T10:00:00Z'),
          endTime: new Date('2026-10-01T11:00:00Z'),
        }),
        findById: jest.fn(),
        update: jest.fn(),
        updateStatus: jest.fn(),
        cancel: jest.fn(),
        reschedule: jest.fn(),
      };
      const clinicNotificationPlugin = {
        notify: jest.fn().mockResolvedValue({ success: true }),
      };

      const service = createService({ coreAppointmentService, clinicNotificationPlugin });

      const result = await (service as any).createAppointment({
        patientUserId: 'patient-1',
        doctorUserId: 'doctor-1',
        clinicId: 'clinic-1',
        appointmentType: 'IN_PERSON',
        startTime: '2026-10-01T10:00:00Z',
        endTime: '2026-10-01T11:00:00Z',
        requestedByUserId: 'patient-1',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('apt-123');
    });

    it('should reject appointment creation with invalid data', async () => {
      const businessRules = {
        validate: jest.fn().mockResolvedValue({
          valid: false,
          errors: ['Invalid time range'],
        }),
      };
      const errors = {
        validationError: jest.fn(() => { throw new Error('Invalid appointment data'); }),
        clinicNotFound: jest.fn(() => new Error('Clinic not found')),
        userNotFound: jest.fn(() => new Error('User not found')),
        appointmentNotFound: jest.fn(() => new Error('Appointment not found')),
      };

      const service = createService({ businessRules, errors });

      await expect(
        (service as any).createAppointment({
          patientUserId: 'patient-1',
          doctorUserId: 'doctor-1',
          clinicId: 'clinic-1',
          appointmentType: 'IN_PERSON',
          startTime: '2026-10-01T10:00:00Z',
          endTime: '2026-10-01T09:00:00Z', // end before start
          requestedByUserId: 'patient-1',
        })
      ).rejects.toThrow();
    });
  });

  describe('getAppointmentById', () => {
    it('should return appointment by id', async () => {
      const coreAppointmentService = {
        create: jest.fn(),
        findById: jest.fn().mockResolvedValue({
          id: 'apt-123',
          patientUserId: 'patient-1',
          doctorUserId: 'doctor-1',
          clinicId: 'clinic-1',
          status: 'SCHEDULED',
        }),
        update: jest.fn(),
        updateStatus: jest.fn(),
        cancel: jest.fn(),
        reschedule: jest.fn(),
      };

      const service = createService({ coreAppointmentService });
      const result = await (service as any).getAppointmentById('apt-123', 'clinic-1');

      expect(result).toBeDefined();
      expect(result.id).toBe('apt-123');
    });

    it('should throw when appointment not found', async () => {
      const coreAppointmentService = {
        create: jest.fn(),
        findById: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateStatus: jest.fn(),
        cancel: jest.fn(),
        reschedule: jest.fn(),
      };
      const errors = {
        validationError: jest.fn(() => new Error('Validation error')),
        clinicNotFound: jest.fn(() => new Error('Clinic not found')),
        userNotFound: jest.fn(() => new Error('User not found')),
        appointmentNotFound: jest.fn(() => { throw new Error('Appointment not found'); }),
      };

      const service = createService({ coreAppointmentService, errors });

      await expect(
        (service as any).getAppointmentById('nonexistent', 'clinic-1')
      ).rejects.toThrow();
    });
  });

  describe('getAppointments', () => {
    it('should return appointments with filters', async () => {
      const coreAppointmentService = {
        create: jest.fn(),
        findById: jest.fn(),
        update: jest.fn(),
        updateStatus: jest.fn(),
        cancel: jest.fn(),
        reschedule: jest.fn(),
      };
      const cacheService = {
        cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        getString: jest.fn(),
        setString: jest.fn(),
      };
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue([
          {
            id: 'apt-1',
            patientUserId: 'patient-1',
            doctorUserId: 'doctor-1',
            clinicId: 'clinic-1',
            status: 'SCHEDULED',
          },
        ]),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findClinicByIdSafe: jest.fn(),
      };

      const service = createService({ coreAppointmentService, cacheService, databaseService });
      const result = await (service as any).getAppointments({
        userId: 'user-1',
        clinicId: 'clinic-1',
        role: Role.PATIENT,
        page: 1,
        limit: 10,
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('cancelAppointment', () => {
    it('should cancel an appointment', async () => {
      const coreAppointmentService = {
        create: jest.fn(),
        findById: jest.fn().mockResolvedValue({
          id: 'apt-123',
          status: 'SCHEDULED',
        }),
        update: jest.fn(),
        updateStatus: jest.fn().mockResolvedValue({
          id: 'apt-123',
          status: 'CANCELLED',
        }),
        cancel: jest.fn().mockResolvedValue({ count: 1 }),
        reschedule: jest.fn(),
      };
      const billingService = {
        syncAppointmentBilling: jest.fn(),
        triggerRefund: jest.fn(),
      };

      const service = createService({ coreAppointmentService, billingService });
      const result = await (service as any).cancelAppointment('apt-123', 'clinic-1', 'user-123');

      expect(result).toBeDefined();
      expect(billingService.triggerRefund).toHaveBeenCalled();
    });

    it('should throw when cancelling non-existent appointment', async () => {
      const coreAppointmentService = {
        create: jest.fn(),
        findById: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateStatus: jest.fn(),
        cancel: jest.fn(),
        reschedule: jest.fn(),
      };
      const errors = {
        validationError: jest.fn(() => new Error('Validation error')),
        clinicNotFound: jest.fn(() => new Error('Clinic not found')),
        userNotFound: jest.fn(() => new Error('User not found')),
        appointmentNotFound: jest.fn(() => { throw new Error('Appointment not found'); }),
      };

      const service = createService({ coreAppointmentService, errors });

      await expect(
        (service as any).cancelAppointment('nonexistent', 'clinic-1', 'user-123')
      ).rejects.toThrow();
    });
  });

  describe('processCheckIn', () => {
    it('should process check-in for an appointment', async () => {
      const checkInService = {
        processCheckIn: jest.fn().mockResolvedValue({
          appointmentId: 'apt-123',
          checkedIn: true,
          checkInTime: new Date(),
        }),
      };
      const coreAppointmentService = {
        create: jest.fn(),
        findById: jest.fn().mockResolvedValue({
          id: 'apt-123',
          status: 'CONFIRMED',
        }),
        update: jest.fn(),
        updateStatus: jest.fn(),
        cancel: jest.fn(),
        reschedule: jest.fn(),
      };

      const service = createService({ checkInService, coreAppointmentService });
      const result = await (service as any).processCheckIn('apt-123', 'clinic-1', {
        userId: 'patient-1',
        role: Role.PATIENT,
      });

      expect(result).toBeDefined();
      expect(result.checkedIn).toBe(true);
    });
  });

  describe('completeAppointment', () => {
    it('should mark appointment as completed', async () => {
      const coreAppointmentService = {
        create: jest.fn(),
        findById: jest.fn().mockResolvedValue({
          id: 'apt-123',
          status: 'IN_PROGRESS',
        }),
        update: jest.fn().mockResolvedValue({
          id: 'apt-123',
          status: 'COMPLETED',
        }),
        updateStatus: jest.fn().mockResolvedValue({
          id: 'apt-123',
          status: 'COMPLETED',
        }),
        cancel: jest.fn(),
        reschedule: jest.fn(),
      };

      const service = createService({ coreAppointmentService });
      const result = await (service as any).completeAppointment('apt-123', 'clinic-1', {
        userId: 'doctor-1',
        role: Role.DOCTOR,
      });

      expect(result).toBeDefined();
      expect(result.status).toBe('COMPLETED');
    });
  });

  describe('rescheduleAppointment', () => {
    it('should reschedule an appointment to a new time', async () => {
      const coreAppointmentService = {
        create: jest.fn(),
        findById: jest.fn().mockResolvedValue({
          id: 'apt-123',
          status: 'SCHEDULED',
        }),
        update: jest.fn().mockResolvedValue({
          id: 'apt-123',
          startTime: new Date('2026-10-02T10:00:00Z'),
          endTime: new Date('2026-10-02T11:00:00Z'),
        }),
        updateStatus: jest.fn(),
        cancel: jest.fn(),
        reschedule: jest.fn().mockResolvedValue({
          id: 'apt-123',
          rescheduled: true,
        }),
      };

      const service = createService({ coreAppointmentService });
      const result = await (service as any).rescheduleAppointment(
        'apt-123',
        'clinic-1',
        {
          startTime: '2026-10-02T10:00:00Z',
          endTime: '2026-10-02T11:00:00Z',
        },
        { userId: 'patient-1', role: Role.PATIENT },
      );

      expect(result).toBeDefined();
    });
  });

  describe('reassignDoctor', () => {
    it('should reassign appointment to a different doctor', async () => {
      const coreAppointmentService = {
        create: jest.fn(),
        findById: jest.fn().mockResolvedValue({
          id: 'apt-123',
          doctorUserId: 'doctor-1',
          clinicId: 'clinic-1',
        }),
        update: jest.fn().mockResolvedValue({
          id: 'apt-123',
          doctorUserId: 'doctor-2',
        }),
        updateStatus: jest.fn(),
        cancel: jest.fn(),
        reschedule: jest.fn(),
      };
      const clinicNotificationPlugin = {
        notify: jest.fn().mockResolvedValue({ success: true }),
      };

      const service = createService({ coreAppointmentService, clinicNotificationPlugin });
      const result = await (service as any).reassignDoctor('apt-123', 'doctor-2', 'clinic-1', {
        userId: 'clinic-admin-1',
        role: Role.CLINIC_ADMIN,
      });

      expect(result).toBeDefined();
      expect(result.doctorUserId).toBe('doctor-2');
    });
  });

  describe('clinic isolation', () => {
    it('should filter appointments by clinic', async () => {
      const coreAppointmentService = {
        create: jest.fn(),
        findById: jest.fn(),
        update: jest.fn(),
        updateStatus: jest.fn(),
        cancel: jest.fn(),
        reschedule: jest.fn(),
      };
      const cacheService = {
        cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        getString: jest.fn(),
        setString: jest.fn(),
      };
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue([]),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findClinicByIdSafe: jest.fn(),
      };

      const service = createService({ coreAppointmentService, cacheService, databaseService });
      await (service as any).getAppointments({
        userId: 'user-1',
        clinicId: 'clinic-1',
        role: Role.PATIENT,
      });

      expect(databaseService.executeHealthcareRead).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ clinicId: 'clinic-1' }),
        }),
      );
    });
  });

  describe('role-based access', () => {
    it('should allow clinic admin to view all appointments', async () => {
      const rbacService = {
        checkPermission: jest.fn().mockResolvedValue(true),
      };
      const coreAppointmentService = {
        create: jest.fn(),
        findById: jest.fn(),
        update: jest.fn(),
        updateStatus: jest.fn(),
        cancel: jest.fn(),
        reschedule: jest.fn(),
      };
      const cacheService = {
        cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        getString: jest.fn(),
        setString: jest.fn(),
      };
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue([]),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
        findClinicByIdSafe: jest.fn(),
      };

      const service = createService({
        coreAppointmentService,
        cacheService,
        databaseService,
        rbacService,
      });
      const result = await (service as any).getAppointments({
        userId: 'admin-1',
        clinicId: 'clinic-1',
        role: Role.CLINIC_ADMIN,
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should restrict patient from viewing other patients appointments', async () => {
      const rbacService = {
        checkPermission: jest.fn().mockResolvedValue(false),
      };

      const service = createService({ rbacService });

      await expect(
        (service as any).getAppointments({
          userId: 'patient-1',
          clinicId: 'clinic-1',
          role: Role.PATIENT,
          targetUserId: 'patient-2',
        })
      ).rejects.toThrow();
    });
  });
});
