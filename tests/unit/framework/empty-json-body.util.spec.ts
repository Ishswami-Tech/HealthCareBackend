import { describe, expect, it } from '@jest/globals';
import {
  dropEmptyJsonContentType,
  isEmptyJsonBodyRequest,
} from '@infrastructure/framework/adapters/empty-json-body.util';

describe('empty JSON body (FST_ERR_CTP_EMPTY_JSON_BODY)', () => {
  it('drops the JSON content type of a request with Content-Length 0', () => {
    const headers: Record<string, string | undefined> = {
      'content-type': 'application/json; charset=utf-8',
      'content-length': '0',
    };
    expect(dropEmptyJsonContentType(headers)).toBe(true);
    expect(headers['content-type']).toBeUndefined();
  });

  it('treats JSON with neither a length nor a transfer encoding as no body (curl -X POST)', () => {
    expect(isEmptyJsonBodyRequest({ 'content-type': 'application/json' })).toBe(true);
  });

  it('leaves a request with a body, a chunked body or another content type alone', () => {
    expect(
      isEmptyJsonBodyRequest({ 'content-type': 'application/json', 'content-length': '2' })
    ).toBe(false);
    expect(
      isEmptyJsonBodyRequest({
        'content-type': 'application/json',
        'content-length': '0',
        'transfer-encoding': 'chunked',
      })
    ).toBe(false);
    expect(isEmptyJsonBodyRequest({ 'content-type': 'text/plain', 'content-length': '0' })).toBe(
      false
    );
    expect(isEmptyJsonBodyRequest({ 'content-length': '0' })).toBe(false);
    const headers: Record<string, string | undefined> = {
      'content-type': 'application/json',
      'content-length': '5',
    };
    expect(dropEmptyJsonContentType(headers)).toBe(false);
    expect(headers['content-type']).toBe('application/json');
  });
});
