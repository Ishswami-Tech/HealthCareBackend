/**
 * GET /queue: a receptionist always reads its own location's queue (location from the staff
 * assignment, never from the query) and the list is paged on the server.
 */
import { ForbiddenException } from '@nestjs/common';
import { QueueController } from '@infrastructure/queue/src/controllers/queue.controller';

const CLINIC = 'clinic-1';

function entry(n: number, locationId: string) {
  return {
    id: `e-${n}`,
    appointmentId: `apt-${n}`,
    patientId: `pat-${n}`,
    doctorId: 'doc-1',
    locationId,
    status: 'WAITING',
    position: n,
    tokenNumber: n,
    checkedInAt: new Date().toISOString(),
  };
}

function build(receptionLocation: string | null, locations: Array<{ id: string; name: string }>) {
  const clinicQueue = [
    ...Array.from({ length: 5 }, (_, i) => entry(i + 1, 'loc-a')),
    ...Array.from({ length: 3 }, (_, i) => entry(i + 10, 'loc-b')),
  ];
  const appointmentQueueService = {
    getClinicQueue: jest.fn(async () => clinicQueue),
    getQueuePauseStatus: jest.fn(async () => 'ACTIVE'),
  };
  const client = {
    user: {
      findUnique: jest.fn(async () => ({
        receptionists: receptionLocation
          ? { locationId: receptionLocation, location: { name: 'Desk' } }
          : null,
      })),
    },
    receptionist: {
      findFirst: jest.fn(async () =>
        receptionLocation ? { locationId: receptionLocation } : null
      ),
    },
    clinicLocation: { findMany: jest.fn(async () => locations) },
    appointment: { findMany: jest.fn(async () => []) },
  };
  const databaseService = {
    executeHealthcareRead: jest.fn(async (op: (c: unknown) => unknown) => op(client)),
  };
  const controller = new QueueController(
    appointmentQueueService as never,
    { getSupportedQueueFilters: () => [], getQueueFilterCatalog: () => [] } as never,
    {} as never,
    databaseService as never
  );
  return { controller };
}

const req = (role: string, query: Record<string, string> = {}) =>
  ({
    user: { sub: 'u-1', role },
    clinicContext: { clinicId: CLINIC },
    query,
  }) as never;

describe('GET /queue location scope and paging', () => {
  it('pins a receptionist to its allotted location, whatever it asks for', async () => {
    const { controller } = build('loc-b', []);
    const out = await controller.listQueue({ locationId: 'loc-a' }, req('RECEPTIONIST'));
    expect(out.data.map(e => e.locationId)).toEqual(['loc-b', 'loc-b', 'loc-b']);
    expect(out.meta['locationId']).toBe('loc-b');
  });

  it('refuses an unallotted receptionist in a multi-location clinic', async () => {
    const { controller } = build(null, [
      { id: 'loc-a', name: 'A' },
      { id: 'loc-b', name: 'B' },
    ]);
    await expect(controller.listQueue({}, req('RECEPTIONIST'))).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it('other roles keep their filter; the list is paged server side', async () => {
    const { controller } = build(null, []);
    const out = await controller.listQueue(
      { locationId: 'loc-a', page: '2', limit: '2' },
      req('CLINIC_ADMIN')
    );
    expect(out.data.map(e => e.appointmentId)).toEqual(['apt-3', 'apt-4']);
    expect(out.meta).toMatchObject({ total: 5, page: 2, limit: 2, totalPages: 3 });
  });
});
