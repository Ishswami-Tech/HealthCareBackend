import { describe, expect, it } from '@jest/globals';
import { PassThrough } from 'stream';
import {
  dropContentTypeOfEmptyBody,
  headersDeclareNoBody,
  settleEmptyChunkedBody,
  streamHasData,
  type EmptyBodyRequest,
  type RequestHeaderBag,
} from '@infrastructure/framework/adapters/empty-body.util';

function request(
  headers: RequestHeaderBag,
  method = 'DELETE',
  httpVersionMajor = 1
): EmptyBodyRequest {
  return { method, httpVersionMajor, headers };
}

describe('empty request body: headers', () => {
  it('drops any content type of a request with Content-Length 0', () => {
    for (const type of ['application/json; charset=utf-8', 'text/plain', 'application/xml']) {
      const headers: RequestHeaderBag = { 'content-type': type, 'content-length': '0' };
      expect(dropContentTypeOfEmptyBody(request(headers, 'POST'))).toBe(true);
      expect(headers['content-type']).toBeUndefined();
    }
  });

  it('treats neither a length nor a transfer encoding as no body (curl -X POST)', () => {
    const headers: RequestHeaderBag = { 'content-type': 'application/json' };
    expect(headersDeclareNoBody(request(headers))).toBe(true);
    expect(dropContentTypeOfEmptyBody(request(headers, 'POST'))).toBe(true);
  });

  it('leaves a request with a body, or a chunked one, alone', () => {
    expect(headersDeclareNoBody(request({ 'content-length': '2' }))).toBe(false);
    expect(
      headersDeclareNoBody(request({ 'content-length': '0', 'transfer-encoding': 'chunked' }))
    ).toBe(false);
    const headers: RequestHeaderBag = {
      'content-type': 'application/json',
      'content-length': '5',
    };
    expect(dropContentTypeOfEmptyBody(request(headers))).toBe(false);
    expect(headers['content-type']).toBe('application/json');
    const chunked: RequestHeaderBag = {
      'content-type': 'application/json',
      'transfer-encoding': 'chunked',
    };
    expect(dropContentTypeOfEmptyBody(request(chunked))).toBe(false);
    expect(chunked['content-type']).toBe('application/json');
  });

  it('has nothing to drop without a content type', () => {
    expect(dropContentTypeOfEmptyBody(request({ 'content-length': '0' }))).toBe(false);
  });

  it('never infers an empty body over HTTP/2, where bodies need no Content-Length', () => {
    const headers: RequestHeaderBag = { 'content-type': 'application/x-www-form-urlencoded' };
    expect(headersDeclareNoBody(request(headers, 'POST', 2))).toBe(false);
    expect(dropContentTypeOfEmptyBody(request(headers, 'POST', 2))).toBe(false);
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded');
  });

  it('leaves multipart, unparsed methods and QUERY to their own handling', () => {
    const multipart: RequestHeaderBag = {
      'content-type': 'multipart/form-data; boundary=x',
      'content-length': '0',
    };
    expect(dropContentTypeOfEmptyBody(request(multipart, 'POST'))).toBe(false);
    expect(multipart['content-type']).toBe('multipart/form-data; boundary=x');
    for (const method of ['GET', 'HEAD', 'TRACE', 'QUERY']) {
      const headers: RequestHeaderBag = { 'content-type': 'application/json' };
      expect(dropContentTypeOfEmptyBody(request(headers, method))).toBe(false);
      expect(headers['content-type']).toBe('application/json');
    }
  });
});

describe('empty request body: chunked stream', () => {
  function readAll(stream: PassThrough): Promise<string> {
    return new Promise((resolve, reject) => {
      let text = '';
      stream.on('data', (chunk: Buffer) => (text += chunk.toString()));
      stream.on('end', () => resolve(text));
      stream.on('error', reject);
      stream.resume();
    });
  }

  it('rewrites a chunked request whose body is empty as bodyless', async () => {
    const stream = new PassThrough();
    const headers: RequestHeaderBag = {
      'transfer-encoding': 'chunked',
      'content-type': 'application/json',
    };
    const settled = settleEmptyChunkedBody(request(headers), stream);
    stream.end();
    await expect(settled).resolves.toBe(true);
    expect(headers).toEqual({});
  });

  it('keeps a chunked body intact, every byte still readable', async () => {
    const stream = new PassThrough();
    const headers: RequestHeaderBag = {
      'transfer-encoding': 'chunked',
      'content-type': 'application/json',
    };
    const settled = settleEmptyChunkedBody(request(headers, 'POST'), stream);
    stream.write('{"a":');
    await expect(settled).resolves.toBe(false);
    expect(headers['content-type']).toBe('application/json');
    expect(headers['transfer-encoding']).toBe('chunked');
    stream.end('1}');
    await expect(readAll(stream)).resolves.toBe('{"a":1}');
  });

  it('does not touch a request whose length is in its headers', async () => {
    const stream = new PassThrough();
    const headers: RequestHeaderBag = {
      'content-length': '2',
      'content-type': 'application/json',
    };
    await expect(settleEmptyChunkedBody(request(headers, 'POST'), stream)).resolves.toBe(false);
    expect(stream.listenerCount('readable')).toBe(0);
  });

  it('does not read the stream of methods Fastify never parses, or of multipart', async () => {
    for (const [method, type] of [
      ['GET', 'application/json'],
      ['HEAD', 'application/json'],
      ['POST', 'multipart/form-data; boundary=x'],
    ] as const) {
      const stream = new PassThrough();
      const headers: RequestHeaderBag = { 'transfer-encoding': 'chunked', 'content-type': type };
      await expect(settleEmptyChunkedBody(request(headers, method), stream)).resolves.toBe(false);
      expect(stream.listenerCount('readable')).toBe(0);
      expect(headers['transfer-encoding']).toBe('chunked');
    }
  });

  it('turns a broken stream into a client error', async () => {
    const stream = new PassThrough();
    const pending = streamHasData(stream);
    stream.destroy(new Error('aborted'));
    await expect(pending).rejects.toMatchObject({ message: 'aborted', statusCode: 400 });
  });
});
