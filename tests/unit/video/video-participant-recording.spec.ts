/// <reference types="jest" />
/**
 * VideoService writes `video_participants`: a join when someone is handed into the call (meeting
 * token, start route), a leave when the patient leaves or the consultation ends (doctor's end,
 * admin terminate). Recording is best effort: a failed write never fails the join.
 *
 * All collaborators are plain mocks; the raw-SQL client is the harness's `rawSql`.
 */

import { LogLevel } from '@core/types';
import type { VideoService } from '@services/video/video.service';

jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));
jest.mock('@queue/src/queue.service', () => ({ QueueService: class QueueService {} }));
jest.mock('@core/rbac/rbac.service', () => ({ RbacService: class RbacService {} }));
jest.mock('@config/config.service', () => ({ ConfigService: class ConfigService {} }));
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));
jest.mock('@infrastructure/events/event.service', () => ({ EventService: class EventService {} }));
jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));
jest.mock('@services/video/providers/video-provider.factory', () => ({
  VideoProviderFactory: class VideoProviderFactory {},
}));

import {
  DOCTOR_USER,
  PATIENT_USER,
  START_MS,
  USER_INFO,
  createHarness,
  makeAppointment,
  mockNow,
  patientCaller,
  staffCaller,
} from './video-service.harness';

type Harness = ReturnType<typeof createHarness>;

/** Answers the consultation lookup with `vc-1` and every other statement with one row. */
function arrangeConsultation(rawSql: Harness['rawSql']): void {
  rawSql.$queryRawUnsafe.mockImplementation(async (sql: string) =>
    sql.includes('FROM "video_consultations" c') ? [{ id: 'vc-1' }] : []
  );
}

function statements(rawSql: Harness['rawSql']): Array<{ sql: string; args: unknown[] }> {
  return rawSql.$queryRawUnsafe.mock.calls.map((call: unknown[]) => ({
    sql: String(call[0]),
    args: call.slice(1),
  }));
}

function insert(rawSql: Harness['rawSql']) {
  return statements(rawSql).find(s => s.sql.includes('INSERT INTO "video_participants"'));
}

function leave(rawSql: Harness['rawSql']) {
  return statements(rawSql).find(s => s.sql.includes('SET "status" = \'LEFT\''));
}

const patientToken = (service: VideoService): Promise<unknown> =>
  service.generateMeetingToken('appt-1', PATIENT_USER, 'patient', USER_INFO, patientCaller());

describe('VideoService participant recording', () => {
  beforeEach(() => {
    mockNow(START_MS);
  });

  it("records the patient's join when the meeting token is issued", async () => {
    const { service, rawSql } = createHarness();
    arrangeConsultation(rawSql);

    await patientToken(service);

    expect(insert(rawSql)?.args).toEqual([
      expect.any(String),
      'vc-1',
      PATIENT_USER,
      'PARTICIPANT',
      expect.any(String),
    ]);
  });

  it("records the doctor's join as the host", async () => {
    const { service, rawSql, clients } = createHarness();
    clients.appointment['updateMany']?.mockResolvedValue({ count: 0 });
    arrangeConsultation(rawSql);

    await service.generateMeetingToken(
      'appt-1',
      DOCTOR_USER,
      'doctor',
      USER_INFO,
      staffCaller('DOCTOR')
    );

    expect(insert(rawSql)?.args[3]).toBe('HOST');
  });

  it('never records the system caller (the meeting-URL lookup)', async () => {
    const { service, databaseService, rawSql } = createHarness();
    arrangeConsultation(rawSql);

    await service
      .generateMeetingToken('appt-1', 'system', 'doctor', USER_INFO, staffCaller('SUPER_ADMIN'))
      .catch(() => undefined);

    expect(databaseService['executeInTransaction']).not.toHaveBeenCalled();
  });

  it('still issues the token when the participant write fails, and logs a warning', async () => {
    const { service, rawSql, loggingService } = createHarness();
    rawSql.$queryRawUnsafe.mockRejectedValue(new Error('db down'));

    const token = (await patientToken(service)) as { token: string };

    expect(token.token).toBe('meeting-token');
    const warning = loggingService.log.mock.calls.find(
      (call: unknown[]) => call[3] === 'VideoService.recordParticipantJoin'
    );
    expect(warning?.[1]).toBe(LogLevel.WARN);
  });

  it('records a join on the explicit start route', async () => {
    const { service, rawSql } = createHarness();
    arrangeConsultation(rawSql);

    await service.startConsultation('appt-1', PATIENT_USER, 'patient', patientCaller());

    expect(insert(rawSql)?.args[2]).toBe(PATIENT_USER);
  });

  it("closes only the patient's row when the patient leaves", async () => {
    const { service, rawSql } = createHarness();

    await service.endConsultation('appt-1', PATIENT_USER, 'patient', undefined, patientCaller());

    expect(leave(rawSql)?.args).toEqual(['appt-1', expect.any(String), PATIENT_USER]);
  });

  it('closes every open row when the doctor ends the visit', async () => {
    const { service, rawSql, clients } = createHarness();
    clients.appointment['findUnique']?.mockResolvedValue(
      makeAppointment({ status: 'IN_PROGRESS' })
    );

    await service.endConsultation(
      'appt-1',
      DOCTOR_USER,
      'doctor',
      undefined,
      staffCaller('DOCTOR')
    );

    expect(leave(rawSql)?.args).toEqual(['appt-1', expect.any(String), null]);
  });
});
