import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { fingerprint } from './fingerprint.ts';

const req = (body: unknown, path = '/register', method = 'POST') =>
  ({ method, baseUrl: '/api/v1/user', path, body }) as Request;

describe('fingerprint', () => {
  it('ignores object key order', () => {
    assert.equal(
      fingerprint.of(req({ b: 1, a: { d: true, c: 'x' } })),
      fingerprint.of(req({ a: { c: 'x', d: true }, b: 1 })),
    );
  });

  it('changes when the body, path, or method changes', () => {
    const base = fingerprint.of(req({ email: 'a@example.com' }));
    assert.notEqual(fingerprint.of(req({ email: 'b@example.com' })), base);
    assert.notEqual(fingerprint.of(req({ email: 'a@example.com' }, '/other')), base);
    assert.notEqual(fingerprint.of(req({ email: 'a@example.com' }, '/register', 'PATCH')), base);
  });

  it('hashes the raw key instead of storing it', () => {
    const hashed = fingerprint.key('replay-key-1');
    assert.notEqual(hashed, 'replay-key-1');
    assert.equal(hashed, fingerprint.key('replay-key-1'));
  });
});
