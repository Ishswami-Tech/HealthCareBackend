/// <reference types="jest" />
/**
 * The primary tracker used to open a fresh TLS + SCRAM connection to the pg_auto_failover monitor
 * every 3 s. From India to a monitor in Europe that costs ~0.8 s of a 2 s budget, so any lost
 * packet timed the check out ("Could not check the current Postgres primary" several times an
 * hour). queryMonitorReusingConnection keeps one connection open and only reconnects after a
 * failure.
 */

import { EventEmitter } from 'events';

class FakeClient extends EventEmitter {
  static instances: FakeClient[] = [];
  static failNextConnect = false;
  connect = jest.fn(() => {
    if (FakeClient.failNextConnect) {
      FakeClient.failNextConnect = false;
      return Promise.reject(new Error('timeout expired'));
    }
    return Promise.resolve();
  });
  query = jest.fn(() => Promise.resolve({ rows: [{ nodehost: '10.201.0.5', nodeport: 6261 }] }));
  end = jest.fn(() => Promise.resolve());
  constructor(public readonly config: unknown) {
    super();
    FakeClient.instances.push(this);
  }
}

jest.mock('pg', () => ({ Client: jest.fn((config: unknown) => new FakeClient(config)) }));

import {
  closeMonitorSessions,
  queryMonitorReusingConnection,
} from '@infrastructure/database/prisma/monitor-client.util';

const MONITOR = 'postgres://autoctl_node@10.201.0.1:6260/pg_auto_failover';
const SQL = 'SELECT nodehost, nodeport FROM pgautofailover.node';

beforeEach(() => {
  closeMonitorSessions();
  FakeClient.instances = [];
  FakeClient.failNextConnect = false;
});

describe('queryMonitorReusingConnection', () => {
  it('reuses one connection for repeated polls', async () => {
    await queryMonitorReusingConnection(MONITOR, SQL);
    await queryMonitorReusingConnection(MONITOR, SQL);
    await queryMonitorReusingConnection(MONITOR, SQL);

    expect(FakeClient.instances).toHaveLength(1);
    expect(FakeClient.instances[0]!.connect).toHaveBeenCalledTimes(1);
    expect(FakeClient.instances[0]!.query).toHaveBeenCalledTimes(3);
  });

  it('keeps the monitor TLS settings and the 2 s budget', async () => {
    await queryMonitorReusingConnection(MONITOR, SQL);

    expect(FakeClient.instances[0]!.config).toEqual(
      expect.objectContaining({
        connectionString: MONITOR,
        connectionTimeoutMillis: 2000,
        query_timeout: 2000,
        ssl: { rejectUnauthorized: false },
      })
    );
  });

  it('drops the connection after a failed query and reconnects on the next poll', async () => {
    await queryMonitorReusingConnection(MONITOR, SQL);
    const first = FakeClient.instances[0]!;
    first.query.mockRejectedValueOnce(new Error('Query read timeout'));

    await expect(queryMonitorReusingConnection(MONITOR, SQL)).rejects.toThrow('Query read timeout');
    expect(first.end).toHaveBeenCalled();

    await queryMonitorReusingConnection(MONITOR, SQL);
    expect(FakeClient.instances).toHaveLength(2);
  });

  it('reports a failed connect and opens a new connection next time', async () => {
    FakeClient.failNextConnect = true;
    await expect(queryMonitorReusingConnection(MONITOR, SQL)).rejects.toThrow('timeout expired');
    expect(FakeClient.instances[0]!.end).toHaveBeenCalled();

    await expect(queryMonitorReusingConnection(MONITOR, SQL)).resolves.toHaveLength(1);
    expect(FakeClient.instances).toHaveLength(2);
  });

  it('survives the idle connection dying (an unhandled pg error would crash the process)', async () => {
    await queryMonitorReusingConnection(MONITOR, SQL);
    const first = FakeClient.instances[0]!;

    expect(() =>
      first.emit('error', new Error('Connection terminated unexpectedly'))
    ).not.toThrow();
    expect(first.end).toHaveBeenCalled();

    await queryMonitorReusingConnection(MONITOR, SQL);
    expect(FakeClient.instances).toHaveLength(2);
  });
});
