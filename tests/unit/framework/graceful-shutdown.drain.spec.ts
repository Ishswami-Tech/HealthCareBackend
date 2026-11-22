/// <reference types="jest" />
/**
 * API shutdown during a rolling deploy.
 *
 * Temps sends SIGTERM and SIGKILLs 10 s later. The API now drains first: it stops accepting
 * connections, closes idle keep-alive connections at once (the proxy keeps them open for up to
 * 65 s, which used to make `server.close()` wait out its whole timeout), lets running requests
 * finish within IN_FLIGHT_WAIT_MS, and only then closes the database, cache and app, all inside
 * SHUTDOWN_TIMEOUT_MS.
 */

jest.mock('@infrastructure/logging/logging.service', () => ({ LoggingService: class {} }));
jest.mock('@infrastructure/database/database.service', () => ({ DatabaseService: class {} }));
jest.mock('@infrastructure/framework/adapters/fastify.adapter', () => ({
  createFrameworkAdapter: jest.fn(),
}));

import * as http from 'http';
import type { AddressInfo } from 'net';
import {
  IN_FLIGHT_WAIT_MS,
  SHUTDOWN_TIMEOUT_MS,
  drainHttpServer,
} from '@core/resilience/graceful-shutdown.service';

function startServer(handler: http.RequestListener): Promise<http.Server> {
  const server = http.createServer({ keepAliveTimeout: 65_000 }, handler);
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function get(
  server: http.Server,
  agent: http.Agent
): Promise<{ status: number | undefined; body: string }> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: '/', agent }, res => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString()));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });
}

describe('API shutdown budget', () => {
  it('fits the drain and the cleanup inside the 10 s Temps grace', () => {
    expect(IN_FLIGHT_WAIT_MS).toBeLessThan(SHUTDOWN_TIMEOUT_MS);
    expect(SHUTDOWN_TIMEOUT_MS).toBeLessThan(10_000);
  });
});

describe('drainHttpServer', () => {
  it('lets a running request finish, and is not held up by an idle keep-alive connection', async () => {
    let finish: () => void = () => undefined;
    const server = await startServer((req, res) => {
      if (req.headers['x-slow']) {
        finish = () => res.end('slow done');
        return;
      }
      res.end('fast');
    });
    const keepAlive = new http.Agent({ keepAlive: true });

    // An idle keep-alive connection, like the ones the Temps proxy holds.
    await expect(get(server, keepAlive)).resolves.toMatchObject({ body: 'fast' });

    const { port } = server.address() as AddressInfo;
    const slow = new Promise<string>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/', headers: { 'x-slow': '1' } }, res => {
          let body = '';
          res.on('data', (chunk: Buffer) => (body += chunk.toString()));
          res.on('end', () => resolve(body));
        })
        .on('error', reject);
    });
    await new Promise(resolve => setTimeout(resolve, 50)); // the slow request is running

    const started = Date.now();
    const drained = drainHttpServer(server, 5_000);
    setTimeout(() => finish(), 200);

    await expect(slow).resolves.toBe('slow done');
    await expect(drained).resolves.toBe('drained');
    expect(Date.now() - started).toBeLessThan(2_000);
    keepAlive.destroy();
  });

  it('closes what is still running once the wait is over', async () => {
    const server = await startServer(() => {
      // never answers
    });
    const { port } = server.address() as AddressInfo;
    const hung = new Promise<string>(resolve => {
      http
        .get({ host: '127.0.0.1', port, path: '/' }, () => resolve('answered'))
        .on('error', () => resolve('connection closed'));
    });
    await new Promise(resolve => setTimeout(resolve, 50));

    await expect(drainHttpServer(server, 300)).resolves.toBe('timed-out');
    await expect(hung).resolves.toBe('connection closed');
  });
});
