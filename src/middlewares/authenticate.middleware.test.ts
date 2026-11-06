import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { AppError, UnauthorizedError } from '#errors';
import { APP_ERROR_CODES } from '#constants/error/appErrorCodes.constant';
import { createAuthenticateMiddleware } from './authenticate.middleware.ts';

type Claims = Record<string, unknown>;

const validClaims: Claims = { sub: 'u1', email: 'a@example.com', role: 'NORMAL', exp: 1 };

const run = (authorization: string | undefined, verify: (token: string) => Claims) => {
  const headers: Record<string, string> = {};
  const req = { headers: authorization === undefined ? {} : { authorization } } as Request;
  const res = { set: (k: string, v: string) => (headers[k] = v) } as unknown as Response;
  const forwarded: unknown[] = [];

  createAuthenticateMiddleware({ accessTokens: { verify } })(req, res, (err?: unknown) =>
    forwarded.push(err),
  );
  return { req, headers, err: forwarded[0], calls: forwarded.length };
};

const neverCalled = () => assert.fail('verify must not run');

describe('authenticate', () => {
  it('sets req.user from valid claims, keeping only id, email and role', () => {
    const seen: string[] = [];
    const { req, err, calls, headers } = run('Bearer abc.def.ghi', (token) => {
      seen.push(token);
      return validClaims;
    });

    assert.equal(calls, 1);
    assert.equal(err, undefined);
    assert.deepEqual(seen, ['abc.def.ghi']);
    assert.deepEqual(req.user, { id: 'u1', email: 'a@example.com', role: 'NORMAL' });
    assert.deepEqual(headers, {});
  });

  it('accepts the scheme in any case, since auth schemes are case-insensitive', () => {
    assert.equal(run('bearer t', () => validClaims).err, undefined);
  });

  it('answers 401 with a bare challenge when no credentials were sent', () => {
    const { err, headers } = run(undefined, neverCalled);

    assert.ok(err instanceof UnauthorizedError);
    assert.equal(err.code, APP_ERROR_CODES.UNAUTHORIZED);
    assert.deepEqual(headers, { 'WWW-Authenticate': 'Bearer' });
  });

  for (const header of ['', 'Basic dXNlcjpwYXNz', 'Bearer', 'Bearer ', 'Bearer a b', 'Bearera']) {
    it(`answers 401 invalid_token for the header ${JSON.stringify(header)}`, () => {
      const { err, headers } = run(header, neverCalled);

      assert.ok(err instanceof UnauthorizedError);
      assert.equal(err.code, APP_ERROR_CODES.TOKEN_INVALID);
      assert.deepEqual(headers, { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
    });
  }

  it('forwards what verify throws, so the JWT converter picks its status and code', () => {
    const thrown = Object.assign(new Error('jwt expired'), { name: 'TokenExpiredError' });
    const { err, headers } = run('Bearer t', () => {
      throw thrown;
    });

    assert.equal(err, thrown);
    assert.deepEqual(headers, { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
  });

  for (const [label, claims] of [
    ['no subject', { email: 'a@example.com', role: 'NORMAL' }],
    ['an unknown role', { ...validClaims, role: 'ROOT' }],
    ['a bad email', { ...validClaims, email: 'nope' }],
    ['an unsafe id', { ...validClaims, sub: 'a/b' }],
  ] as const) {
    it(`answers 401 for a signed token with ${label}`, () => {
      const { req, err } = run('Bearer t', () => claims);

      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 401);
      assert.equal(err.code, APP_ERROR_CODES.TOKEN_INVALID);
      assert.equal(req.user, undefined);
    });
  }
});
