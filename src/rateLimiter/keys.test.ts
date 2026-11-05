import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { keys } from './keys.ts';

const ctx = { ipv6Subnet: 56 };

const request = (fields: Record<string, unknown>) => fields as unknown as Request;

describe('keys', () => {
  describe('user', () => {
    it('keys on the authenticated user id', () => {
      assert.equal(keys.user(request({ user: { id: 'u_1' } }), ctx), 'user:u_1');
    });

    it('returns undefined on a public route, where req.user is not set', () => {
      assert.equal(keys.user(request({}), ctx), undefined);
    });
  });

  describe('first', () => {
    it('falls through to the next key on a public route', () => {
      const key = keys.first(keys.user, keys.ip)(request({ ip: '203.0.113.7' }), ctx);
      assert.equal(key, 'ip:203.0.113.7');
    });

    it('prefers the user key once authenticated', () => {
      const key = keys.first(keys.user, keys.ip)(
        request({ ip: '203.0.113.7', user: { id: 'u_1' } }),
        ctx,
      );
      assert.equal(key, 'user:u_1');
    });
  });
});
