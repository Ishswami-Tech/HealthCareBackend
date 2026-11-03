/**
 * The real InPersonCheckInService (+ real InPersonVisitService) on a spec's FakeDb and real
 * CheckInLocationService, so the controller specs exercise POST /appointments/check-in/scan-qr
 * as the thin delegate it is: the very same path as POST /in-person/check-in.
 */
import { jest } from '@jest/globals';
import { InPersonCheckInService } from '@services/appointments/in-person/in-person-check-in.service';
import { InPersonVisitService } from '@services/appointments/in-person/in-person-visit.service';

/**
 * Minimal DatabaseService for InPersonCheckInService's clinic-settings read
 * (appointmentSettings.opdControls: qrCheckInEnabled / requireLocationForQrCheckIn, df4f03ed).
 * Empty controls = the production defaults (QR check-in on, poster scans need the position).
 */
export function opdControlsDatabase(opdControls: Record<string, unknown> = {}): {
  executeHealthcareRead: jest.Mock<
    (operation: (client: unknown) => Promise<unknown>) => Promise<unknown>
  >;
} {
  const client = {
    clinic: {
      findUnique: async (): Promise<{ settings: unknown }> => ({
        settings: { appointmentSettings: { opdControls } },
      }),
    },
  };
  return {
    executeHealthcareRead: jest.fn(async (operation: (client: unknown) => Promise<unknown>) =>
      operation(client)
    ),
  };
}

export function createInPersonCheckIn(deps: {
  db: object;
  checkInLocationService: object;
  queue: object;
  events: object;
  logging: object;
  locationQr?: object;
  checkInLog?: object;
}): InPersonCheckInService {
  const visits = new InPersonVisitService(deps.db as never, deps.queue as never);
  return new InPersonCheckInService(
    deps.checkInLocationService as never,
    visits,
    (deps.locationQr ?? { inspectLocationQR: jest.fn(() => 'VALID') }) as never,
    deps.events as never,
    deps.logging as never,
    deps.db as never,
    deps.checkInLog as never
  );
}
