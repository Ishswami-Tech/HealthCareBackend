import { describe, expect, it } from '@jest/globals';
import { PassThrough } from 'stream';
import {
  dropContentTypeOfEmptyBody,
  headersDeclareNoBody,
  settleEmptyChunkedBody,
  streamHasData,
} from '@infrastructure/framework/adapters/empty-body.util';

describe('empty request body: headers', () => {
  it('drops any content type of a request with Content-Length 0', () => {
    for (const type of ['application/json; charset=utf-8', 'text/plain', 'application/xml']) {
      const headers: Record<string, string | undefined> = {
        'content-type': type,
        'content-length': '0',
      };
      expect(dropContentTypeOfEmptyBody(headers)).toBe(true);
      expect(headers['content-type']).toBeUndefined();
    }
  });

  it('treats neither a length nor a transfer encoding as no body (curl -X POST)', () => {
    expect(headersDeclareNoBody({ 'content-type': 'application/json' })).toBe(true);
    const headers: Record<string, string | undefined> = { 'content-type': 'application/json' };
    expect(dropContentTypeOfEmptyBody(headers)).toBe(true);
  });

  it('leaves a request with a body, or a chunked one, alone', () => {
    expect(headersDeclareNoBody({ 'content-length': '2' })).toBe(false);
    expect(headersDeclareNoBody({ 'content-length': '0', 'transfer-encoding': 'chunked' })).toBe(
      false
    );
    const headers: Record<string, string | undefined> = {
      'content-type': 'application/json',
      'content-length': '5',
    };
    expect(dropContentTypeOfEmptyBody(headers)).toBe(false);
    expect(headers['content-type']).toBe('application/json');
    const chunked: Record<string, string | undefined> = {
      'content-type': 'application/json',
      'transfer-encoding': 'chunked',
    };
    expect(dropContentTypeOfEmptyBody(chunked)).toBe(false);
    expect(chunked['content-type']).toBe('application/json');
  });

  it('has nothing to drop without a content type', () => {
    expect(dropContentTypeOfEmptyBody({ 'content-length': '0' })).toBe(false);
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
    const headers: Record<string, string | undefined> = {
      'transfer-encoding': 'chunked',
      'content-type': 'application/json',
    };
    const settled = settleEmptyChunkedBody(headers, stream);
    stream.end();
    await expect(settled).resolves.toBe(true);
    expect(headers).toEqual({});
  });

  it('keeps a chunked body intact, every byte still readable', async () => {
    const stream = new PassThrough();
    const headers: Record<string, string | undefined> = {
      'transfer-encoding': 'chunked',
      'content-type': 'application/json',
    };
    const settled = settleEmptyChunkedBody(headers, stream);
    stream.write('{"a":');
    await expect(settled).resolves.toBe(false);
    expect(headers['content-type']).toBe('application/json');
    expect(headers['transfer-encoding']).toBe('chunked');
    stream.end('1}');
    await expect(readAll(stream)).resolves.toBe('{"a":1}');
  });

  it('does not touch a request whose length is in its headers', async () => {
    const stream = new PassThrough();
    const headers: Record<string, string | undefined> = {
      'content-length': '2',
      'content-type': 'application/json',
    };
    await expect(settleEmptyChunkedBody(headers, stream)).resolves.toBe(false);
    expect(stream.listenerCount('readable')).toBe(0);
  });

  it('turns a broken stream into a client error', async () => {
    const stream = new PassThrough();
    const pending = streamHasData(stream);
    stream.destroy(new Error('aborted'));
    await expect(pending).rejects.toMatchObject({ message: 'aborted', statusCode: 400 });
  });
});
