/// <reference types="jest" />
/**
 * Requests without a body must never fail on their Content-Type.
 *
 * Production (Temps proxy) forwards a bodyless DELETE as `Transfer-Encoding: chunked` with a
 * zero-length body, even when the client sent `Content-Length: 0`. Fastify then cannot tell the
 * body is empty, runs the content-type parser and answers 415 (no Content-Type) or 400 (JSON),
 * before any guard or handler runs. These tests boot the real adapter (same Fastify options and
 * hooks as main.ts) on a socket and send raw HTTP, both as a client sends it and as the proxy
 * forwards it.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { Body, Controller, Delete, Module, Param, Post, Put, Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { FastifyFrameworkAdapter } from '@infrastructure/framework/adapters/fastify.adapter';

type JsonBody = Record<string, string | number | boolean | null> | string | null;

interface EchoResponse {
  readonly method: string;
  readonly body: JsonBody;
}

@Controller('echo')
class EchoController {
  @Delete(':id')
  remove(@Param('id') _id: string, @Body() body: JsonBody | undefined): EchoResponse {
    return { method: 'DELETE', body: body ?? null };
  }

  @Post(':id')
  create(@Param('id') _id: string, @Body() body: JsonBody | undefined): EchoResponse {
    return { method: 'POST', body: body ?? null };
  }

  @Put(':id')
  replace(@Param('id') _id: string, @Body() body: JsonBody | undefined): EchoResponse {
    return { method: 'PUT', body: body ?? null };
  }
}

@Module({ controllers: [EchoController] })
class EchoModule {}

interface SendOptions {
  readonly contentType?: string;
  readonly body?: string;
  /** Forward the way the proxy does: `Transfer-Encoding: chunked`, no Content-Length. */
  readonly chunked?: boolean;
}

interface SendResult {
  readonly status: number;
  readonly json: EchoResponse;
}

describe('empty request bodies through the real Fastify setup', () => {
  let app: INestApplication;
  let port: number;

  function send(method: string, options: SendOptions = {}): Promise<SendResult> {
    const headers: Record<string, string> = {};
    if (options.contentType !== undefined) headers['content-type'] = options.contentType;
    if (options.chunked) {
      headers['transfer-encoding'] = 'chunked';
    } else if (options.body !== undefined) {
      headers['content-length'] = String(Buffer.byteLength(options.body));
    }
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, method, path: '/echo/42', headers, agent: false },
        res => {
          let raw = '';
          res.on('data', (chunk: Buffer) => (raw += chunk.toString()));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(raw) as SendResult['json'] })
          );
        }
      );
      req.on('error', reject);
      if (options.body !== undefined) req.write(options.body);
      req.end();
    });
  }

  beforeAll(async () => {
    process.env['LOG_LEVEL'] = 'silent';
    app = await new FastifyFrameworkAdapter().createApplication(
      EchoModule,
      {
        environment: 'test',
        isHorizontalScaling: false,
        instanceId: 'test',
        trustProxy: true,
        bodyLimit: 1024 * 1024,
        keepAliveTimeout: 5_000,
        connectionTimeout: 5_000,
        requestTimeout: 5_000,
      },
      new Logger('EmptyBodySpec')
    );
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
  });

  describe.each([
    ['as the client sends it', false],
    ['as the proxy forwards it (chunked)', true],
  ])('%s', (_label, chunked) => {
    it('accepts a DELETE with no Content-Type and no body', async () => {
      const res = await send('DELETE', { chunked });
      expect(res.status).toBe(200);
      expect(res.json.body).toBeNull();
    });

    it('accepts a DELETE declaring application/json with an empty body', async () => {
      const res = await send('DELETE', { chunked, contentType: 'application/json' });
      expect(res.status).toBe(200);
      expect(res.json.body).toBeNull();
    });

    it('parses a DELETE with application/json and {}', async () => {
      const res = await send('DELETE', { chunked, contentType: 'application/json', body: '{}' });
      expect(res.status).toBe(200);
      expect(res.json.body).toEqual({});
    });

    it('accepts a DELETE declaring text/plain with no body', async () => {
      const res = await send('DELETE', { chunked, contentType: 'text/plain' });
      expect(res.status).toBe(200);
    });

    it('accepts an empty body whatever media type it declares', async () => {
      const res = await send('POST', { chunked, contentType: 'application/xml' });
      expect(res.status).toBe(201);
      expect(res.json.body).toBeNull();
    });

    it('accepts a POST with no Content-Type and no body', async () => {
      const res = await send('POST', { chunked });
      expect(res.status).toBe(201);
      expect(res.json.body).toBeNull();
    });

    it('still parses a real JSON body on POST and PUT', async () => {
      const body = JSON.stringify({ name: 'x', count: 2 });
      const post = await send('POST', { chunked, contentType: 'application/json', body });
      expect(post.status).toBe(201);
      expect(post.json).toEqual({ method: 'POST', body: { name: 'x', count: 2 } });
      const put = await send('PUT', { chunked, contentType: 'application/json', body });
      expect(put.status).toBe(200);
      expect(put.json).toEqual({ method: 'PUT', body: { name: 'x', count: 2 } });
    });

    it('still rejects malformed JSON', async () => {
      const res = await send('POST', { chunked, contentType: 'application/json', body: '{"a":' });
      expect(res.status).toBe(400);
    });

    it('still answers 415 to a real body of an unsupported media type', async () => {
      const res = await send('POST', { chunked, contentType: 'application/xml', body: '<a/>' });
      expect(res.status).toBe(415);
    });

    it('still answers 415 to a real body with no Content-Type', async () => {
      const res = await send('POST', { chunked, body: 'payload' });
      expect(res.status).toBe(415);
    });
  });
});
