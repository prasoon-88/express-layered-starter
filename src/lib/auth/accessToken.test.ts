import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createAccessTokens } from './accessToken.ts';

const SECRET = 's'.repeat(32);
const START = Date.UTC(2026, 0, 1);

const setup = (overrides: Partial<Parameters<typeof createAccessTokens>[0]> = {}) => {
  let nowMs = START;
  const tokens = createAccessTokens({
    secret: SECRET,
    issuer: 'svc',
    audience: 'svc',
    ttlS: 60,
    now: () => nowMs,
    ...overrides,
  });
  const advance = (s: number) => (nowMs += s * 1000);
  return { tokens, advance };
};

const claims = { sub: 'u1', email: 'a@b.co', role: 'NORMAL' };

const errorNamed = (name: string) => (err: unknown) => err instanceof Error && err.name === name;

describe('createAccessTokens', () => {
  it('refuses a secret shorter than 32 characters', () => {
    assert.throws(() => setup({ secret: 'short' }), RangeError);
  });

  it('refuses a ttl that is not a positive whole number', () => {
    for (const ttlS of [0, -1, 1.5, Number.NaN])
      assert.throws(() => setup({ ttlS }), RangeError, String(ttlS));
  });

  it('round-trips the claims and reports the lifetime', () => {
    const { tokens } = setup();
    const { token, expiresIn } = tokens.sign(claims);

    assert.equal(expiresIn, 60);
    const payload = tokens.verify(token);
    assert.equal(payload.sub, 'u1');
    assert.equal(payload.email, 'a@b.co');
    assert.equal(payload.role, 'NORMAL');
    assert.equal(Number(payload.exp) - Number(payload.iat), 60);
    assert.equal(payload.iat, START / 1000, 'iat comes from the injected clock');
  });

  it('accepts a token until it expires, then rejects it', () => {
    const { tokens, advance } = setup();
    const { token } = tokens.sign(claims);

    advance(60);
    assert.doesNotThrow(() => tokens.verify(token), 'still valid inside the clock tolerance');
    advance(10);
    assert.throws(() => tokens.verify(token), errorNamed('TokenExpiredError'));
  });

  it('rejects a token signed with another secret', () => {
    const { tokens } = setup();
    const other = setup({ secret: 'o'.repeat(32) }).tokens.sign(claims).token;
    assert.throws(() => tokens.verify(other), errorNamed('JsonWebTokenError'));
  });

  it('rejects a token for another issuer or audience', () => {
    const { tokens } = setup();
    for (const opts of [{ issuer: 'other' }, { audience: 'other' }]) {
      const token = setup(opts).tokens.sign(claims).token;
      assert.throws(
        () => tokens.verify(token),
        errorNamed('JsonWebTokenError'),
        JSON.stringify(opts),
      );
    }
  });

  it('rejects an unsigned ("alg: none") token', () => {
    const { tokens } = setup();
    const unsigned = jwt.sign({ ...claims, iss: 'svc', aud: 'svc' }, null, { algorithm: 'none' });
    assert.throws(() => tokens.verify(unsigned), errorNamed('JsonWebTokenError'));
  });

  it('rejects the same secret with a different HMAC algorithm', () => {
    const { tokens } = setup();
    const hs512 = jwt.sign({ email: 'a@b.co', role: 'NORMAL' }, SECRET, {
      algorithm: 'HS512',
      subject: 'u1',
      issuer: 'svc',
      audience: 'svc',
      expiresIn: 60,
    });
    assert.throws(() => tokens.verify(hs512), errorNamed('JsonWebTokenError'));
  });

  it('rejects a token whose payload was edited', () => {
    const { tokens } = setup();
    const [header, payload, signature] = tokens.sign(claims).token.split('.');
    const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as object;
    const forged = Buffer.from(JSON.stringify({ ...decoded, role: 'ADMIN' })).toString('base64url');

    assert.throws(
      () => tokens.verify(`${header}.${forged}.${signature}`),
      errorNamed('JsonWebTokenError'),
    );
  });

  it('rejects garbage', () => {
    const { tokens } = setup();
    for (const token of ['', 'abc', 'a.b.c'])
      assert.throws(() => tokens.verify(token), errorNamed('JsonWebTokenError'), token);
  });
});
