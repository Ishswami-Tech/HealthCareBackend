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
import * as net from 'net';
import {
  IN_FLIGHT_WAIT_MS,
  SHUTDOWN_TIMEOUT_MS,
  drainHttpServer,
  trackInFlightRequests,
} from '@core/resilience/graceful-shutdown.service';
import { WORKER_LIFECYCLE } from '@infrastructure/queue/src/queue.constants';

/** Temps stops containers with a fixed 10 s grace before SIGKILL (temps-agent journal). */
const TEMPS_STOP_GRACE_MS = 10_000;

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
  it('fits the API drain and the cleanup inside the 10 s Temps grace', () => {
    expect(IN_FLIGHT_WAIT_MS).toBeLessThan(SHUTDOWN_TIMEOUT_MS);
    expect(SHUTDOWN_TIMEOUT_MS).toBeLessThan(TEMPS_STOP_GRACE_MS);
  });

  it('gives the worker drain most of the grace and still exits before the SIGKILL', () => {
    expect(WORKER_LIFECYCLE.closeTimeoutMs).toBeGreaterThanOrEqual(8_000);
    expect(WORKER_LIFECYCLE.closeTimeoutMs).toBeLessThan(WORKER_LIFECYCLE.shutdownTimeoutMs);
    expect(WORKER_LIFECYCLE.shutdownTimeoutMs).toBeLessThan(TEMPS_STOP_GRACE_MS);
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

  it('is not held up by an open WebSocket (upgraded) connection or Socket.IO polling', async () => {
    const server = await startServer((req, res) => {
      if (req.url?.startsWith('/socket.io/')) return; // long-poll: held open, never answered
      res.end('ok');
    });
    server.on('upgrade', (_req, socket: net.Socket) => {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'
      );
    });
    const inFlight = trackInFlightRequests(server);
    const { port } = server.address() as AddressInfo;

    const ws = net.connect(port, '127.0.0.1');
    await new Promise<void>(resolve => {
      ws.on('connect', () => {
        ws.write(
          'GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'
        );
      });
      ws.once('data', () => resolve());
    });
    http
      .get({ host: '127.0.0.1', port, path: '/socket.io/?EIO=4&transport=polling' })
      .on('error', () => undefined);
    await new Promise(resolve => setTimeout(resolve, 50));

    const started = Date.now();
    await expect(drainHttpServer(server, 3_000, undefined, inFlight)).resolves.toBe('drained');
    expect(Date.now() - started).toBeLessThan(1_000);
    ws.destroy();
    server.closeAllConnections();
  });
});
