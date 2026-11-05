import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import httpConverter from './http.converter.ts';

// What `http-errors` (used by Express and body-parser) produces for a client-visible error.
const httpError = (status: number) =>
  Object.assign(new Error(`status ${status}`), { status, expose: true });

describe('httpConverter', () => {
  const cases: [number, string][] = [
    [400, 'BAD_REQUEST'],
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [408, 'REQUEST_TIMEOUT'],
    [409, 'CONFLICT'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
    [422, 'VALIDATION_FAILED'],
    [429, 'TOO_MANY_REQUESTS'],
    [500, 'INTERNAL_ERROR'],
  ];

  for (const [status, code] of cases) {
    it(`maps ${status} to ${code}`, () => {
      const converted = httpConverter(httpError(status));
      assert.equal(converted?.statusCode, status);
      assert.equal(converted?.code, code);
    });
  }

  it('falls back to BAD_REQUEST for an unmapped client error', () => {
    assert.equal(httpConverter(httpError(418))?.code, 'BAD_REQUEST');
  });

  it('ignores errors that are not safe to expose', () => {
    assert.equal(httpConverter(Object.assign(new Error('x'), { status: 400 })), null);
  });
});
