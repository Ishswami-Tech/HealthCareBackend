import { LogLevel, LogType } from '@core/types';
import { AppointmentNotificationService } from '@services/appointments/plugins/notifications/appointment-notification.service';

describe('AppointmentNotificationService recipient resolution', () => {
  const createService = (options?: {
    patientUserId?: string | null;
    directUserId?: string | null;
  }): {
    service: AppointmentNotificationService;
    loggingService: { log: jest.Mock<Promise<void>, unknown[]> };
    databaseService: {
      executeHealthcareRead: jest.Mock<Promise<{ userId: string } | null>, unknown[]>;
      findUserByIdSafe: jest.Mock<Promise<{ id: string } | null>, unknown[]>;
    };
  } => {
    const loggingService = {
      log: jest.fn<Promise<void>, unknown[]>(async () => undefined),
    };
    const databaseService = {
      executeHealthcareRead: jest.fn<Promise<{ userId: string } | null>, unknown[]>(
        async callback => {
          const patient = options?.patientUserId ? { userId: options.patientUserId } : null;
          return (await (callback as (client: unknown) => Promise<{ userId: string } | null>)({
            patient: {
              findUnique: jest.fn(async () => patient),
            },
          })) as { userId: string } | null;
        }
      ),
      findUserByIdSafe: jest.fn<Promise<{ id: string } | null>, unknown[]>(async () =>
        options?.directUserId ? { id: options.directUserId } : null
      ),
    };

    const service = new AppointmentNotificationService(
      {},
      loggingService,
      {},
      {},
      {},
      {},
      {},
      {},
      databaseService
    ) as AppointmentNotificationService;

    return { service, loggingService, databaseService };
  };

  const resolvePatientUserId = (
    service: AppointmentNotificationService,
    patientId: string
  ): Promise<string | null> =>
    (
      service as unknown as {
        resolvePatientUserId(patientId: string, notificationId: string): Promise<string | null>;
      }
    ).resolvePatientUserId(patientId, 'notification-1');

  it('resolves a Patient.id to its owning User.id', async () => {
    const { service, loggingService, databaseService } = createService({
      patientUserId: 'user-from-patient',
    });

    await expect(resolvePatientUserId(service, 'patient-1')).resolves.toBe('user-from-patient');

    expect(databaseService.findUserByIdSafe).not.toHaveBeenCalled();
    expect(loggingService.log).not.toHaveBeenCalled();
  });

  it('accepts a direct User.id without logging patient record warnings', async () => {
    const { service, loggingService, databaseService } = createService({
      directUserId: 'user-direct',
    });

    await expect(resolvePatientUserId(service, 'user-direct')).resolves.toBe('user-direct');

    expect(databaseService.findUserByIdSafe).toHaveBeenCalledWith('user-direct');
    expect(loggingService.log).not.toHaveBeenCalledWith(
      LogType.NOTIFICATION,
      LogLevel.WARN,
      expect.stringContaining('Patient record not found'),
      'AppointmentNotificationService.resolvePatientUserId',
      expect.anything()
    );
  });

  it('warns only when the recipient is neither a Patient.id nor a User.id', async () => {
    const { service, loggingService } = createService();

    await expect(resolvePatientUserId(service, 'missing-recipient')).resolves.toBeNull();

    expect(loggingService.log).toHaveBeenCalledWith(
      LogType.NOTIFICATION,
      LogLevel.WARN,
      'Patient notification recipient could not be resolved from patientId or userId',
      'AppointmentNotificationService.resolvePatientUserId',
      {
        notificationId: 'notification-1',
        patientId: 'missing-recipient',
      }
    );
  });
});
