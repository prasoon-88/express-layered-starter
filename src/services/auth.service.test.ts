import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UnauthorizedError } from '#errors';
import type { AccessClaims } from '#lib/auth/accessToken';
import type { StoredUser } from '#repository/user.repository';
import { createRefreshTokenRepository } from '#repository/refreshToken.repository';
import { hashPassword } from '#utils/password.util';
import type { AuthService } from './auth.service.ts';

process.env.NODE_ENV ??= 'test';

const { createAuthService } = await import('./auth.service.ts');

const PASSWORD = 'correct-horse-1';
const REFRESH_TTL_S = 3600;

const rejectsWith = (code: string) => (err: unknown) =>
  err instanceof UnauthorizedError && err.code === code;

describe('authService', () => {
  let users: Map<string, StoredUser>;
  let signed: AccessClaims[];
  let nowMs: number;
  let auth: AuthService;

  const user = (): StoredUser => users.get('u1')!;

  beforeEach(async () => {
    users = new Map([
      [
        'u1',
        {
          id: 'u1',
          fullName: 'Ada',
          email: 'ada@example.com',
          passwordHash: await hashPassword(PASSWORD),
          role: 'NORMAL',
        },
      ],
    ]);
    signed = [];
    nowMs = 1_000_000;
    auth = createAuthService({
      userRepository: {
        findByEmail: (email) => Promise.resolve([...users.values()].find((u) => u.email === email)),
        findById: (id) => Promise.resolve(users.get(id)),
      },
      refreshTokenRepository: createRefreshTokenRepository(),
      accessTokens: {
        sign: (claims) => {
          signed.push(claims);
          return { token: `access-${signed.length}`, expiresIn: 900 };
        },
      },
      refreshTtlS: REFRESH_TTL_S,
      now: () => nowMs,
    });
  });

  const login = () => auth.login({ email: 'ada@example.com', password: PASSWORD });

  describe('login', () => {
    it('issues an access token for the user and a refresh token', async () => {
      const tokens = await login();

      assert.deepEqual(signed, [{ sub: 'u1', email: 'ada@example.com', role: 'NORMAL' }]);
      assert.equal(tokens.accessToken, 'access-1');
      assert.equal(tokens.tokenType, 'Bearer');
      assert.equal(tokens.expiresIn, 900);
      assert.match(tokens.refreshToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    });

    it('refuses a wrong password and an unknown email the same way', async () => {
      const wrong = auth.login({ email: 'ada@example.com', password: 'nope-nope-nope' });
      const unknown = auth.login({ email: 'who@example.com', password: PASSWORD });

      const errors = await Promise.allSettled([wrong, unknown]);
      for (const result of errors) {
        assert.equal(result.status, 'rejected');
        assert.ok(rejectsWith('INVALID_CREDENTIALS')(result.reason));
      }
      const [a, b] = errors as PromiseRejectedResult[];
      assert.equal((a!.reason as Error).message, (b!.reason as Error).message);
      assert.equal(signed.length, 0);
    });

    it('starts a separate family per login, so logging out one leaves the other', async () => {
      const phone = await login();
      const laptop = await login();

      await auth.logout(phone.refreshToken);

      await assert.rejects(auth.refresh(phone.refreshToken), rejectsWith('TOKEN_INVALID'));
      await assert.doesNotReject(auth.refresh(laptop.refreshToken));
    });
  });

  describe('refresh', () => {
    it('rotates: returns a new pair and the old refresh token stops working', async () => {
      const first = await login();
      const second = await auth.refresh(first.refreshToken);

      assert.notEqual(second.refreshToken, first.refreshToken);
      assert.equal(second.accessToken, 'access-2');
      await assert.doesNotReject(auth.refresh(second.refreshToken));
    });

    it('treats a reused token as theft and revokes every token in its family', async () => {
      const first = await login();
      const second = await auth.refresh(first.refreshToken);

      await assert.rejects(auth.refresh(first.refreshToken), rejectsWith('TOKEN_INVALID'));
      await assert.rejects(auth.refresh(second.refreshToken), rejectsWith('TOKEN_INVALID'));
    });

    it('lets one of two simultaneous refreshes through; the other counts as reuse', async () => {
      const { refreshToken } = await login();

      const results = await Promise.allSettled([
        auth.refresh(refreshToken),
        auth.refresh(refreshToken),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);

      const winner = results.find((r) => r.status === 'fulfilled')!;
      await assert.rejects(auth.refresh(winner.value.refreshToken), rejectsWith('TOKEN_INVALID'));
    });

    it('refuses an expired token with TOKEN_EXPIRED', async () => {
      const { refreshToken } = await login();
      nowMs += REFRESH_TTL_S * 1000;

      await assert.rejects(auth.refresh(refreshToken), rejectsWith('TOKEN_EXPIRED'));
    });

    it('accepts a token one millisecond before it expires', async () => {
      const { refreshToken } = await login();
      nowMs += REFRESH_TTL_S * 1000 - 1;

      await assert.doesNotReject(auth.refresh(refreshToken));
    });

    for (const token of ['', 'abc', 'a.b', 'a.b.c', '.x', 'x.', 'a b.c'])
      it(`refuses the malformed token ${JSON.stringify(token)}`, async () => {
        await assert.rejects(auth.refresh(token), rejectsWith('TOKEN_INVALID'));
      });

    it('refuses a known id with the wrong secret, without burning the real token', async () => {
      const { refreshToken } = await login();
      const [id] = refreshToken.split('.');

      await assert.rejects(auth.refresh(`${id}.forged`), rejectsWith('TOKEN_INVALID'));
      await assert.doesNotReject(auth.refresh(refreshToken));
    });

    it('signs the role the user has now, not the one they had at login', async () => {
      const { refreshToken } = await login();
      user().role = 'ADMIN';

      await auth.refresh(refreshToken);
      assert.equal(signed.at(-1)?.role, 'ADMIN');
    });

    it('refuses and revokes when the user no longer exists', async () => {
      const { refreshToken } = await login();
      users.clear();

      await assert.rejects(auth.refresh(refreshToken), rejectsWith('TOKEN_INVALID'));
    });
  });

  describe('logout', () => {
    it('revokes the whole family, including tokens rotated from it', async () => {
      const first = await login();
      const second = await auth.refresh(first.refreshToken);

      await auth.logout(second.refreshToken);
      await assert.rejects(auth.refresh(second.refreshToken), rejectsWith('TOKEN_INVALID'));
    });

    it('succeeds for an unknown, forged, malformed or already revoked token', async () => {
      const { refreshToken } = await login();
      const [id] = refreshToken.split('.');

      for (const token of ['', 'garbage', `${id}.forged`, refreshToken, refreshToken])
        await assert.doesNotReject(auth.logout(token), token);
    });

    it('ignores a forged secret, so it cannot log someone else out', async () => {
      const { refreshToken } = await login();
      const [id] = refreshToken.split('.');

      await auth.logout(`${id}.forged`);
      await assert.doesNotReject(auth.refresh(refreshToken));
    });
  });
});
