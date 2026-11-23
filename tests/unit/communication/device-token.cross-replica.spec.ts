/// <reference types="jest" />
/**
 * Device tokens across API copies.
 *
 * The API runs one copy per node, and each copy's token cache is loaded at start-up. A phone
 * that registered its token through copy A after copy B started used to be unknown to B, so a
 * sign-out (deactivate) or token refresh (update) that landed on B returned false, the database
 * row stayed active, and pushes kept going to the signed-out phone. B now falls back to the
 * database.
 */

jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@infrastructure/database', () => ({ DatabaseService: class DatabaseService {} }));

import { DeviceTokenService } from '@communication/channels/push/device-token.service';

type Row = {
  userId: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  isActive: boolean;
  lastUsed?: Date;
};

/** Shared "database" with the deviceToken delegate calls the service makes. */
function fakeDatabase() {
  const rows = new Map<string, Row>();
  const deviceToken = {
    findMany: ({ where }: { where: Partial<Row> }) =>
      Promise.resolve(
        [...rows.values()].filter(row =>
          Object.entries(where).every(([key, value]) => row[key as keyof Row] === value)
        )
      ),
    findUnique: ({ where }: { where: { token: string } }) =>
      Promise.resolve(rows.get(where.token) ?? null),
    upsert: ({ where, create }: { where: { token: string }; create: Row }) => {
      rows.set(where.token, { ...create });
      return Promise.resolve();
    },
    updateMany: ({ where, data }: { where: { token: string }; data: Partial<Row> }) => {
      const row = rows.get(where.token);
      if (row) rows.set(where.token, { ...row, ...data });
      return Promise.resolve();
    },
    delete: ({ where }: { where: { token: string } }) => {
      rows.delete(where.token);
      return Promise.resolve();
    },
    create: ({ data }: { data: Row }) => {
      rows.set(data.token, { ...data });
      return Promise.resolve();
    },
  };
  const client = { deviceToken };
  return {
    rows,
    database: {
      executeHealthcareRead: (fn: (c: typeof client) => Promise<unknown>) => fn(client),
      executeHealthcareWrite: (fn: (c: typeof client) => Promise<unknown>) => fn(client),
    },
  };
}

function replica(database: unknown): DeviceTokenService {
  const logging = { log: jest.fn().mockResolvedValue(undefined) };
  return new DeviceTokenService(logging as never, database as never);
}

const TOKEN = 'fcm-token-registered-after-boot';

async function registeredOnAnotherCopy() {
  const db = fakeDatabase();
  const copyB = replica(db.database);
  await copyB.onModuleInit(); // B started before the phone registered
  const copyA = replica(db.database);
  await copyA.onModuleInit();
  await copyA.registerDeviceToken({
    userId: 'user-1',
    token: TOKEN,
    platform: 'android',
    isActive: true,
  });
  return { db, copyB };
}

describe('DeviceTokenService across API copies', () => {
  it('deactivates a token that another copy registered after this one started', async () => {
    const { db, copyB } = await registeredOnAnotherCopy();

    await expect(copyB.deactivateDeviceToken(TOKEN, 'user-1')).resolves.toBe(true);
    expect(db.rows.get(TOKEN)?.isActive).toBe(false);
  });

  it("still refuses to deactivate another user's token", async () => {
    const { db, copyB } = await registeredOnAnotherCopy();

    await expect(copyB.deactivateDeviceToken(TOKEN, 'user-2')).resolves.toBe(false);
    expect(db.rows.get(TOKEN)?.isActive).toBe(true);
  });

  it('refreshes a token that another copy registered after this one started', async () => {
    const { db, copyB } = await registeredOnAnotherCopy();

    await expect(copyB.updateDeviceToken(TOKEN, 'fcm-token-new')).resolves.toBe(true);
    expect(db.rows.has(TOKEN)).toBe(false);
    expect(db.rows.get('fcm-token-new')).toMatchObject({ userId: 'user-1', isActive: true });
  });

  it('answers false for a token no copy knows', async () => {
    const db = fakeDatabase();
    const copy = replica(db.database);
    await copy.onModuleInit();

    await expect(copy.deactivateDeviceToken('unknown-token', 'user-1')).resolves.toBe(false);
  });

  it("finds one token's data from the database for the SNS fallback", async () => {
    const { copyB } = await registeredOnAnotherCopy();

    await expect(copyB.findToken(TOKEN)).resolves.toMatchObject({
      userId: 'user-1',
      platform: 'android',
    });
  });
});
