/// <reference types="jest" />
/**
 * Unit tests for DailyVideoProvider room privacy and meeting-token creation.
 *
 * Production uses Daily rooms that require a meeting token. Room names are deterministic and
 * existing rooms are reused, so a room created while DAILY_PRIVACY was 'public' would otherwise
 * stay joinable by anyone with its URL. These tests pin: new rooms are created private, an
 * existing non-private room is switched to private once per process, a failed switch never
 * blocks a join, and every token is scoped to its room and expires.
 *
 * Daily's REST API is replaced by an in-memory fake behind a mocked global fetch; nothing here
 * touches the network, a database or the real configuration.
 */

import {
  DailyVideoProvider,
  parseAppointmentIdFromRoomName,
} from '@services/video/providers/daily-video.provider';
import {
  buildStableRoomName,
  canTerminateRooms,
  findTerminatingProvider,
} from '@services/video/providers/video-provider.helpers';
import { LogLevel, LogType } from '@core/types';
import type { ConfigService } from '@config/config.service';
import type { LoggingService } from '@infrastructure/logging';
import type { DatabaseService } from '@infrastructure/database/database.service';
import type { DailyHealthSignalService } from '@services/video/services/daily-health-signal.service';
import type { VideoProviderConfig } from '@core/types/video.types';

// The provider only needs these classes as injection tokens (it is built with plain mocks
// below). Replacing them keeps the heavy transitive module graphs out of this unit test.
jest.mock('@config/config.service', () => ({ ConfigService: class ConfigService {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));
jest.mock('@services/video/services/daily-health-signal.service', () => ({
  DailyHealthSignalService: class DailyHealthSignalService {},
}));

type DailyConfig = NonNullable<VideoProviderConfig['daily']>;
/** 'ignored' answers 200 but leaves the room's privacy unchanged (Daily keeps reporting it public). */
type UpdateBehavior = 'ok' | 'ignored' | 'http-500' | 'network-error' | 'hang';
type FakeRoom = { privacy?: string };

type RecordedCall = {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  authorization: string | null;
};

type DeleteBehavior = 'ok' | 'http-500' | 'http-429' | 'network-error' | 'hang';

type FakeDailyOptions = {
  existingRooms?: Record<string, FakeRoom>;
  update?: UpdateBehavior;
  delete?: DeleteBehavior;
};

type FakeDaily = {
  calls: RecordedCall[];
  rooms: Map<string, FakeRoom>;
  roomUpdates: () => RecordedCall[];
  roomCreates: () => RecordedCall[];
  roomDeletes: () => RecordedCall[];
  tokenRequests: () => RecordedCall[];
  /** Change how Daily answers the privacy update from now on (the fake is otherwise fixed). */
  setUpdateBehavior: (behavior: UpdateBehavior) => void;
};

const API_BASE = 'https://api.daily.test/v1';
const API_PATH_PREFIX = '/v1';
const DOMAIN = 'example.daily.test';
const CLINIC_ID = 'clinic-1';
const APPOINTMENT_ID = 'appt-1';
const ROOM_DURATION_MINUTES = 120;
const DAILY_TIMEOUT_MS = 10_000;

const roomNameFor = (appointmentId: string): string =>
  buildStableRoomName('daily', appointmentId, CLINIC_ID);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseBody(init: RequestInit | undefined): Record<string, unknown> | null {
  if (typeof init?.body !== 'string') {
    return null;
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

function installFakeDaily(options: FakeDailyOptions = {}): FakeDaily {
  const rooms = new Map<string, FakeRoom>(Object.entries(options.existingRooms ?? {}));
  const calls: RecordedCall[] = [];
  let updateBehavior: UpdateBehavior = options.update ?? 'ok';
  const deleteBehavior: DeleteBehavior = options.delete ?? 'ok';

  jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname.slice(API_PATH_PREFIX.length);
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = parseBody(init);
      calls.push({
        method,
        path,
        body,
        authorization: new Headers(init?.headers).get('authorization'),
      });

      if (path === '/meeting-tokens' && method === 'POST') {
        return jsonResponse(200, { token: 'daily-meeting-token' });
      }

      if (path === '/rooms' && method === 'POST') {
        const name = String(body?.['name']);
        const privacy = body?.['privacy'];
        rooms.set(name, typeof privacy === 'string' ? { privacy } : {});
        return jsonResponse(200, { name, url: `https://${DOMAIN}/${name}`, privacy });
      }

      const roomMatch = /^\/rooms\/([^/]+)$/.exec(path);
      if (roomMatch) {
        const name = decodeURIComponent(roomMatch[1] ?? '');
        const room = rooms.get(name);

        if (method === 'DELETE') {
          if (deleteBehavior === 'network-error') {
            throw new TypeError('fetch failed');
          }
          if (deleteBehavior === 'http-500' || deleteBehavior === 'http-429') {
            return jsonResponse(deleteBehavior === 'http-500' ? 500 : 429, { error: 'nope' });
          }
          if (deleteBehavior === 'hang') {
            return await new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError'))
              );
            });
          }
          if (!room) {
            return jsonResponse(404, { error: 'not-found' });
          }
          rooms.delete(name);
          return jsonResponse(200, { deleted: true, name });
        }

        if (method === 'GET') {
          if (!room) {
            return jsonResponse(404, { error: 'not-found' });
          }
          return jsonResponse(200, {
            name,
            url: `https://${DOMAIN}/${name}`,
            ...(room.privacy === undefined ? {} : { privacy: room.privacy }),
          });
        }

        if (method === 'POST') {
          if (updateBehavior === 'network-error') {
            throw new TypeError('fetch failed');
          }
          if (updateBehavior === 'http-500') {
            return jsonResponse(500, { error: 'internal' });
          }
          if (updateBehavior === 'hang') {
            return await new Promise<Response>((_resolve, reject) => {
              const signal = init?.signal;
              const abort = (): void => reject(new DOMException('aborted', 'AbortError'));
              if (signal?.aborted) {
                abort();
                return;
              }
              signal?.addEventListener('abort', abort);
            });
          }
          const privacy = body?.['privacy'];
          if (updateBehavior === 'ok') {
            rooms.set(name, typeof privacy === 'string' ? { privacy } : (room ?? {}));
          }
          return jsonResponse(200, { name, privacy });
        }
      }

      return jsonResponse(500, { error: `unexpected ${method} ${path}` });
    });

  return {
    calls,
    rooms,
    roomUpdates: () =>
      calls.filter(call => call.method === 'POST' && /^\/rooms\/[^/]+$/.test(call.path)),
    roomCreates: () => calls.filter(call => call.method === 'POST' && call.path === '/rooms'),
    roomDeletes: () => calls.filter(call => call.method === 'DELETE'),
    setUpdateBehavior: behavior => {
      updateBehavior = behavior;
    },
    tokenRequests: () => calls.filter(call => call.path === '/meeting-tokens'),
  };
}

type ProviderHarness = {
  provider: DailyVideoProvider;
  log: jest.Mock;
  isProduction: jest.Mock;
};

function createProvider(
  configOverrides: Partial<DailyConfig> = {},
  production = false
): ProviderHarness {
  const daily: DailyConfig = {
    apiBaseUrl: API_BASE,
    apiKey: 'test-api-key',
    domain: DOMAIN,
    enabled: true,
    privacy: 'private',
    roomDurationMinutes: ROOM_DURATION_MINUTES,
    ...configOverrides,
  };
  const isProduction = jest.fn().mockReturnValue(production);
  const configService = {
    get: jest.fn().mockReturnValue({ daily }),
    getUrlsConfig: jest.fn().mockReturnValue({ frontend: '' }),
    isProduction,
  } as unknown as ConfigService;
  const log = jest.fn().mockResolvedValue(undefined);
  const loggingService = { log } as unknown as LoggingService;

  const delegate = {
    findFirst: jest.fn().mockResolvedValue(null),
    update: jest.fn(),
    upsert: jest
      .fn()
      .mockImplementation(async (args: { create: Record<string, unknown> }) => args.create),
  };
  const databaseService = {
    findAppointmentByIdSafe: jest.fn().mockImplementation(async (id: string) => ({
      id,
      clinicId: CLINIC_ID,
      patientId: 'patient-1',
      doctorId: 'doctor-1',
      patient: { userId: 'patient-user' },
      doctor: { userId: 'doctor-user' },
    })),
    executeHealthcareWrite: jest.fn(
      async (operation: (client: unknown) => Promise<unknown>): Promise<unknown> =>
        operation({ videoConsultation: delegate })
    ),
  } as unknown as DatabaseService;
  const healthSignal = {
    recordTokenSuccess: jest.fn().mockResolvedValue(undefined),
  } as unknown as DailyHealthSignalService;

  const provider = new DailyVideoProvider(
    configService,
    loggingService,
    databaseService,
    healthSignal
  );
  return { provider, log, isProduction };
}

const USER_INFO = { displayName: 'Test User', email: '' };

async function joinAs(
  provider: DailyVideoProvider,
  role: 'patient' | 'doctor',
  appointmentId: string = APPOINTMENT_ID
): Promise<Awaited<ReturnType<DailyVideoProvider['generateMeetingToken']>>> {
  return await provider.generateMeetingToken(appointmentId, `${role}-user-id`, role, USER_INFO);
}

function securityWarnings(log: jest.Mock): unknown[][] {
  return log.mock.calls.filter(
    (call: unknown[]) => call[0] === LogType.SECURITY && call[1] === LogLevel.WARN
  );
}

describe('DailyVideoProvider room privacy', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('new rooms', () => {
    it('are created with privacy "private" by default', async () => {
      const fake = installFakeDaily();
      const { provider } = createProvider();

      const response = await joinAs(provider, 'patient');

      const creates = fake.roomCreates();
      expect(creates).toHaveLength(1);
      expect(creates[0]?.body?.['privacy']).toBe('private');
      expect(creates[0]?.body?.['name']).toBe(roomNameFor(APPOINTMENT_ID));
      expect(fake.rooms.get(roomNameFor(APPOINTMENT_ID))?.privacy).toBe('private');
      // A freshly created room is already in the right state: no follow-up update.
      expect(fake.roomUpdates()).toHaveLength(0);
      expect(response.token).toBe('daily-meeting-token');
      expect(response.meetingUrl).toBe(`https://${DOMAIN}/${roomNameFor(APPOINTMENT_ID)}`);
    });

    it('keep an explicitly configured public privacy', async () => {
      const fake = installFakeDaily();
      const { provider } = createProvider({ privacy: 'public' });

      await joinAs(provider, 'patient');

      expect(fake.roomCreates()[0]?.body?.['privacy']).toBe('public');
      expect(fake.roomUpdates()).toHaveLength(0);
    });
  });

  describe('reusing an existing public room', () => {
    it('switches it to private with exactly one update call, and not again on the next join', async () => {
      const name = roomNameFor(APPOINTMENT_ID);
      const fake = installFakeDaily({ existingRooms: { [name]: { privacy: 'public' } } });
      const { provider } = createProvider();

      await joinAs(provider, 'doctor');

      const updates = fake.roomUpdates();
      expect(updates).toHaveLength(1);
      expect(updates[0]?.path).toBe(`/rooms/${name}`);
      expect(updates[0]?.body).toEqual({ privacy: 'private' });
      expect(updates[0]?.authorization).toBe('Bearer test-api-key');
      expect(fake.roomCreates()).toHaveLength(0);
      expect(fake.rooms.get(name)?.privacy).toBe('private');

      // The patient joins next (and the doctor may re-request a token): no more updates.
      await joinAs(provider, 'patient');
      await joinAs(provider, 'doctor');

      expect(fake.roomUpdates()).toHaveLength(1);
      expect(fake.tokenRequests()).toHaveLength(3);
    });

    it('does not repeat the update when the room still reports public (once per process)', async () => {
      const name = roomNameFor(APPOINTMENT_ID);
      // Daily keeps reporting the room as public even after the update call.
      const fake = installFakeDaily({
        existingRooms: { [name]: { privacy: 'public' } },
        update: 'ignored',
      });
      const { provider } = createProvider();

      await joinAs(provider, 'patient');
      await joinAs(provider, 'patient');
      await joinAs(provider, 'doctor');

      expect(fake.roomUpdates()).toHaveLength(1);
    });

    it('reconciles each room separately', async () => {
      const first = roomNameFor('appt-1');
      const second = roomNameFor('appt-2');
      const fake = installFakeDaily({
        existingRooms: { [first]: { privacy: 'public' }, [second]: { privacy: 'public' } },
      });
      const { provider } = createProvider();

      await joinAs(provider, 'patient', 'appt-1');
      await joinAs(provider, 'patient', 'appt-2');
      await joinAs(provider, 'doctor', 'appt-1');
      await joinAs(provider, 'doctor', 'appt-2');

      const updatedPaths = fake.roomUpdates().map(call => call.path);
      expect(updatedPaths).toEqual([`/rooms/${first}`, `/rooms/${second}`]);
    });

    it('treats a room that does not report its privacy as needing the update', async () => {
      const name = roomNameFor(APPOINTMENT_ID);
      const fake = installFakeDaily({ existingRooms: { [name]: {} } });
      const { provider } = createProvider();

      await joinAs(provider, 'patient');

      expect(fake.roomUpdates()).toHaveLength(1);
      expect(fake.roomUpdates()[0]?.body).toEqual({ privacy: 'private' });
    });

    it('logs the switch as a security event', async () => {
      const name = roomNameFor(APPOINTMENT_ID);
      installFakeDaily({ existingRooms: { [name]: { privacy: 'public' } } });
      const { provider, log } = createProvider();

      await joinAs(provider, 'patient');

      expect(log).toHaveBeenCalledWith(
        LogType.SECURITY,
        LogLevel.INFO,
        expect.stringContaining("switched to privacy 'private'"),
        'DailyVideoProvider.ensureRoomPrivacy',
        expect.objectContaining({ roomName: name, previousPrivacy: 'public' })
      );
    });
  });

  describe('existing rooms that need no update', () => {
    it('leaves an already private room alone', async () => {
      const name = roomNameFor(APPOINTMENT_ID);
      const fake = installFakeDaily({ existingRooms: { [name]: { privacy: 'private' } } });
      const { provider } = createProvider();

      await joinAs(provider, 'patient');

      expect(fake.roomUpdates()).toHaveLength(0);
      expect(fake.roomCreates()).toHaveLength(0);
    });

    it('never makes a private room public, and does not touch public rooms when public is configured', async () => {
      const privateRoom = roomNameFor('appt-1');
      const publicRoom = roomNameFor('appt-2');
      const fake = installFakeDaily({
        existingRooms: {
          [privateRoom]: { privacy: 'private' },
          [publicRoom]: { privacy: 'public' },
        },
      });
      const { provider } = createProvider({ privacy: 'public' });

      await joinAs(provider, 'patient', 'appt-1');
      await joinAs(provider, 'patient', 'appt-2');

      expect(fake.roomUpdates()).toHaveLength(0);
      expect(fake.rooms.get(privateRoom)?.privacy).toBe('private');
    });
  });

  describe('when the privacy update fails', () => {
    it.each<[string, UpdateBehavior]>([
      ['Daily answers with an error status', 'http-500'],
      ['the request fails at the network level', 'network-error'],
    ])('does not fail the join when %s', async (_label, update) => {
      const name = roomNameFor(APPOINTMENT_ID);
      const fake = installFakeDaily({ existingRooms: { [name]: { privacy: 'public' } }, update });
      const { provider, log } = createProvider();

      const response = await joinAs(provider, 'patient');

      expect(response.token).toBe('daily-meeting-token');
      expect(fake.roomUpdates()).toHaveLength(1);
      expect(fake.tokenRequests()).toHaveLength(1);
      expect(securityWarnings(log)).toHaveLength(1);
      expect(securityWarnings(log)[0]?.[3]).toBe('DailyVideoProvider.ensureRoomPrivacy');
      expect(securityWarnings(log)[0]?.[4]).toEqual(
        expect.objectContaining({ roomName: name, previousPrivacy: 'public' })
      );
    });

    it('is not retried on every later token request, only once the 60 second back-off is over', async () => {
      const name = roomNameFor(APPOINTMENT_ID);
      const fake = installFakeDaily({
        existingRooms: { [name]: { privacy: 'public' } },
        update: 'http-500',
      });
      const { provider } = createProvider();
      const start = 1_800_000_000_000;
      const now = jest.spyOn(Date, 'now').mockReturnValue(start);

      await joinAs(provider, 'patient');
      await joinAs(provider, 'doctor');
      now.mockReturnValue(start + 59_000);
      await joinAs(provider, 'patient');
      expect(fake.roomUpdates()).toHaveLength(1);

      now.mockReturnValue(start + 61_000);
      await joinAs(provider, 'doctor');
      expect(fake.roomUpdates()).toHaveLength(2);
    });

    it('does not leave the room public for the rest of the process after one failed update', async () => {
      const name = roomNameFor(APPOINTMENT_ID);
      const fake = installFakeDaily({
        existingRooms: { [name]: { privacy: 'public' } },
        update: 'http-500',
      });
      const { provider } = createProvider();
      const start = 1_800_000_000_000;
      const now = jest.spyOn(Date, 'now').mockReturnValue(start);

      await joinAs(provider, 'patient');
      expect(fake.rooms.get(name)?.privacy).toBe('public');

      // Daily recovers: the next token request after the back-off switches the room.
      fake.setUpdateBehavior('ok');
      now.mockReturnValue(start + 61_000);
      await joinAs(provider, 'doctor');

      expect(fake.rooms.get(name)?.privacy).toBe('private');
      expect(fake.roomUpdates()).toHaveLength(2);
    });

    it('stops updating once an update has succeeded, whatever failed before it', async () => {
      const name = roomNameFor(APPOINTMENT_ID);
      const fake = installFakeDaily({
        existingRooms: { [name]: { privacy: 'public' } },
        update: 'http-500',
      });
      const { provider } = createProvider();
      const start = 1_800_000_000_000;
      const now = jest.spyOn(Date, 'now').mockReturnValue(start);

      await joinAs(provider, 'patient');
      // Answers 200 but the room keeps reporting public: accepted, so it is remembered.
      fake.setUpdateBehavior('ignored');
      now.mockReturnValue(start + 61_000);
      await joinAs(provider, 'doctor');
      now.mockReturnValue(start + 200_000);
      await joinAs(provider, 'patient');

      expect(fake.roomUpdates()).toHaveLength(2);
    });

    it('does not remember a room as reconciled when the update failed', async () => {
      const name = roomNameFor(APPOINTMENT_ID);
      installFakeDaily({
        existingRooms: { [name]: { privacy: 'public' } },
        update: 'network-error',
      });
      const { provider } = createProvider();

      await joinAs(provider, 'patient');

      const reconciled = (provider as unknown as { privacyReconciledRooms: Set<string> })
        .privacyReconciledRooms;
      expect(reconciled.has(name)).toBe(false);
    });

    it('gives up on a hanging update after the 10 second Daily timeout and still joins', async () => {
      jest.useFakeTimers();
      const name = roomNameFor(APPOINTMENT_ID);
      const fake = installFakeDaily({
        existingRooms: { [name]: { privacy: 'public' } },
        update: 'hang',
      });
      const { provider, log } = createProvider();

      let settled = false;
      const join = joinAs(provider, 'patient').finally(() => {
        settled = true;
      });

      // The update timer only starts once the room lookup has resolved, so advance in steps.
      for (let elapsed = 0; !settled && elapsed < DAILY_TIMEOUT_MS * 2; elapsed += 1000) {
        await jest.advanceTimersByTimeAsync(1000);
      }

      const response = await join;
      expect(response.token).toBe('daily-meeting-token');
      expect(fake.roomUpdates()).toHaveLength(1);
      expect(securityWarnings(log)).toHaveLength(1);
    });
  });

  describe('public-room production warning', () => {
    it('is logged once when public rooms are explicitly configured in production', async () => {
      installFakeDaily();
      const { provider, log } = createProvider({ privacy: 'public' }, true);

      await joinAs(provider, 'patient', 'appt-1');
      await joinAs(provider, 'patient', 'appt-2');

      const warnings = securityWarnings(log);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.[2]).toEqual(expect.stringContaining("privacy 'public' in production"));
    });

    it('is not logged for private rooms, even in production', async () => {
      installFakeDaily();
      const { provider, log } = createProvider({ privacy: 'private' }, true);

      await joinAs(provider, 'patient');

      expect(securityWarnings(log)).toHaveLength(0);
    });

    it('is not logged for public rooms outside production', async () => {
      installFakeDaily();
      const { provider, log } = createProvider({ privacy: 'public' }, false);

      await joinAs(provider, 'patient');

      expect(securityWarnings(log)).toHaveLength(0);
    });
  });
});

describe('DailyVideoProvider meeting tokens', () => {
  it('scope the token to the room and make it expire with the room', async () => {
    const fake = installFakeDaily();
    const { provider } = createProvider();
    const before = Math.floor(Date.now() / 1000);

    await joinAs(provider, 'patient');

    const after = Math.floor(Date.now() / 1000);
    const properties = fake.tokenRequests()[0]?.body?.['properties'] as Record<string, unknown>;
    expect(properties['room_name']).toBe(roomNameFor(APPOINTMENT_ID));
    const exp = properties['exp'] as number;
    expect(exp).toBeGreaterThanOrEqual(before + ROOM_DURATION_MINUTES * 60);
    expect(exp).toBeLessThanOrEqual(after + ROOM_DURATION_MINUTES * 60);
    expect(properties['eject_at_token_exp']).toBe(true);
    expect(properties['user_id']).toBe('patient-user-id');
    expect(fake.tokenRequests()[0]?.authorization).toBe('Bearer test-api-key');
  });

  it('give owner rights to the doctor but not to the patient', async () => {
    const fake = installFakeDaily();
    const { provider } = createProvider();

    await joinAs(provider, 'doctor');
    await joinAs(provider, 'patient');

    const [doctorToken, patientToken] = fake
      .tokenRequests()
      .map(call => call.body?.['properties'] as Record<string, unknown>);
    expect(doctorToken?.['is_owner']).toBe(true);
    expect(patientToken?.['is_owner']).toBe(false);
    expect(patientToken?.['permissions']).toEqual(
      expect.objectContaining({ canAdmin: false, canSend: ['audio', 'video'] })
    );
  });

  it('are minted for the room that was just made private, on a reused room too', async () => {
    const name = roomNameFor(APPOINTMENT_ID);
    const fake = installFakeDaily({ existingRooms: { [name]: { privacy: 'public' } } });
    const { provider } = createProvider();

    const response = await joinAs(provider, 'patient');

    const properties = fake.tokenRequests()[0]?.body?.['properties'] as Record<string, unknown>;
    expect(properties['room_name']).toBe(name);
    expect(response.roomName).toBe(name);
    expect(response.token).toBe('daily-meeting-token');
    // The room is updated before the token is requested.
    const order = fake.calls.map(call => `${call.method} ${call.path}`);
    expect(order.indexOf(`POST /rooms/${name}`)).toBeLessThan(
      order.indexOf('POST /meeting-tokens')
    );
  });
});

describe('DailyVideoProvider.terminateRoom', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('deletes the room with the API key, which ejects everyone in it', async () => {
    const name = roomNameFor(APPOINTMENT_ID);
    const fake = installFakeDaily({ existingRooms: { [name]: { privacy: 'private' } } });
    const { provider } = createProvider();

    await provider.terminateRoom(name);

    const deletes = fake.roomDeletes();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.path).toBe(`/rooms/${name}`);
    expect(deletes[0]?.authorization).toBe('Bearer test-api-key');
    expect(fake.rooms.has(name)).toBe(false);
  });

  it('treats a room Daily no longer knows as already terminated', async () => {
    const fake = installFakeDaily();
    const { provider } = createProvider();

    await expect(provider.terminateRoom(roomNameFor('gone'))).resolves.toBeUndefined();

    expect(fake.roomDeletes()).toHaveLength(1);
  });

  it.each<[string, DeleteBehavior]>([
    ['Daily answers with a server error', 'http-500'],
    ['Daily rate-limits the request', 'http-429'],
  ])('rejects with a provider-outage error when %s', async (_label, behavior) => {
    const name = roomNameFor(APPOINTMENT_ID);
    installFakeDaily({ existingRooms: { [name]: { privacy: 'private' } }, delete: behavior });
    const { provider } = createProvider();

    await expect(provider.terminateRoom(name)).rejects.toThrow(
      /Daily room delete failed with status/
    );
  });

  it('rejects when the request fails at the network level', async () => {
    const name = roomNameFor(APPOINTMENT_ID);
    installFakeDaily({ existingRooms: { [name]: {} }, delete: 'network-error' });
    const { provider } = createProvider();

    await expect(provider.terminateRoom(name)).rejects.toThrow('fetch failed');
  });

  it('gives up on a hanging request after the 10 second Daily timeout', async () => {
    jest.useFakeTimers();
    const name = roomNameFor(APPOINTMENT_ID);
    installFakeDaily({ existingRooms: { [name]: {} }, delete: 'hang' });
    const { provider } = createProvider();

    const outcome = provider.terminateRoom(name).then(
      () => 'resolved',
      (error: Error) => error.name
    );
    await jest.advanceTimersByTimeAsync(DAILY_TIMEOUT_MS + 1);

    await expect(outcome).resolves.toBe('AbortError');
  });

  it('is found by the termination capability check, and only for the room of its own provider', () => {
    const { provider } = createProvider();

    expect(canTerminateRooms(provider)).toBe(true);
    expect(findTerminatingProvider([provider], roomNameFor(APPOINTMENT_ID))).toBe(provider);
    expect(findTerminatingProvider([provider], 'meeting-1234')).toBeUndefined();
  });
});

describe('parseAppointmentIdFromRoomName / listActiveSessions', () => {
  const UUID = '123e4567-e89b-42d3-a456-426614174000';

  it('parses the appointment id (not the hash suffix) from a room name', () => {
    expect(parseAppointmentIdFromRoomName(roomNameFor(UUID))).toBe(UUID);
  });

  it.each([
    '',
    'meeting-1234',
    `daily-appointment-${UUID}`,
    `other-appointment-${UUID}-abc123def456`,
  ])('returns an empty id for %p', name => {
    expect(parseAppointmentIdFromRoomName(name)).toBe('');
  });

  it('lists sessions with the real appointment id', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse(200, { rooms: [{ name: roomNameFor(UUID), url: 'https://x/y' }] })
      );
    const { provider } = createProvider();

    const sessions = await provider.listActiveSessions();

    expect(sessions[0]?.appointmentId).toBe(UUID);
  });

  it('requests the Daily API base URL with the API key, not the room domain', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(200, { rooms: [] }));
    const { provider } = createProvider();

    await provider.listActiveSessions();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${API_BASE}/rooms`);
    expect(new Headers((init as RequestInit).headers).get('authorization')).toBe(
      'Bearer test-api-key'
    );
  });
});
