/// <reference types="jest" />
/**
 * Production logged "MaxListenersExceededWarning: 11 close listeners added to [ServerResponse]"
 * and pg's "client.query() while already executing a query" deprecation with no stack and no
 * request, so neither could be traced. describeProcessWarning keeps both.
 */

import { EventEmitter } from 'events';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';

import { describeProcessWarning } from '@core/resilience/process-warning.util';

/**
 * The warning Node raises for the 11th 'close' listener on a real response, in Node's own shape
 * (events.js builds it with these fields). Jest gives each test file its own `process`, so the
 * real one's 'warning' event cannot be observed here.
 */
function maxListenersWarningFor(url: string): Error {
  const req = new IncomingMessage(new Socket());
  req.method = 'GET';
  req.url = url;
  const res = new ServerResponse(req);
  return Object.assign(
    new Error(
      'Possible EventEmitter memory leak detected. 11 close listeners added to [ServerResponse].'
    ),
    { name: 'MaxListenersExceededWarning', emitter: res, type: 'close', count: 11 }
  );
}

describe('describeProcessWarning', () => {
  it('names the request behind a response MaxListeners warning, without its query string', () => {
    const warning = maxListenersWarningFor('/api/v1/patients/me/dashboard-summary?phone=99');
    const { message, metadata } = describeProcessWarning(warning);

    expect(message).toContain('MaxListenersExceededWarning');
    expect(metadata).toEqual(
      expect.objectContaining({
        name: 'MaxListenersExceededWarning',
        event: 'close',
        listeners: 11,
        emitter: 'ServerResponse',
        request: 'GET /api/v1/patients/me/dashboard-summary',
      })
    );
    // In production the stack points at the code that added the 11th listener.
    expect(String(metadata['stack'])).toContain('maxListenersWarningFor');
    expect(JSON.stringify(metadata)).not.toContain('phone=');
  });

  it('keeps the code and stack of a deprecation warning', () => {
    const warning = Object.assign(new Error('Calling client.query() ... is deprecated'), {
      name: 'DeprecationWarning',
      code: 'PG_QUERY_QUEUE',
    });
    const { metadata } = describeProcessWarning(warning);

    expect(metadata).toEqual(
      expect.objectContaining({ name: 'DeprecationWarning', code: 'PG_QUERY_QUEUE' })
    );
    expect(metadata['stack']).toBe(warning.stack);
    expect(metadata).not.toHaveProperty('request');
  });

  it('handles an emitter that is not an HTTP response', () => {
    const warning = Object.assign(new Error('11 error listeners added to [EventEmitter]'), {
      name: 'MaxListenersExceededWarning',
      emitter: new EventEmitter(),
      type: 'error',
      count: 11,
    });

    expect(describeProcessWarning(warning).metadata).toEqual(
      expect.objectContaining({ emitter: 'EventEmitter', event: 'error', listeners: 11 })
    );
  });
});
